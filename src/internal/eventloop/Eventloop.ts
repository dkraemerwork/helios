/**
 * Bun-native transport adapter replacing the Java TPC (Thread-Per-Core) engine.
 *
 * Design principles (from plan §Block 2.4 / Runtime Architecture Delta):
 *  - Wire-compatible frame transport: data is passed through as-is; framing is
 *    handled by higher layers (Packet/ClientMessage codecs).
 *  - Per-connection FIFO ordering: guaranteed by TCP + single-threaded Bun event loop.
 *  - Bounded outbound buffering: {@link EventloopChannel.write} returns `false` when
 *    the pending-bytes counter for that channel would exceed {@link EventloopOptions.maxOutboundBytes}.
 *    Callers must close or wait for drain rather than silently dropping data.
 *  - Explicit close semantics: once closed, further writes return `false`.
 *  - No threads / no AtomicXxx — Bun is single-threaded; plain counters suffice.
 *
 * Semantic delta vs Java TPC:
 *  - Java ran one thread per core with dedicated I/O reactors.  Here the Bun event
 *    loop handles all I/O on a single thread.  The protocol-facing behavior is
 *    identical; the parallelism model differs.
 *  - Java used `ByteBuffer` rings for the OS write path.  Here we rely on Bun's
 *    internal socket buffer plus our application-level pending counter for back-
 *    pressure signaling.
 */

// ─── minimal socket interface ─────────────────────────────────────────────────

/** Only the write/end surface of a Bun TCP socket that EventloopChannel needs. */
interface SocketWriter {
    write(data: Buffer | string): number;
    end(data?: Buffer | string): void;
}

// ─── public types ─────────────────────────────────────────────────────────────

/** Event callbacks for an {@link EventloopChannel}. All are optional. */
export interface EventloopCallbacks {
    /** Fired when the connection is established (after TCP handshake). */
    onConnect?: (channel: EventloopChannel) => void;
    /** Fired when data arrives. `data` is a view into the socket's read buffer — copy
     *  it (e.g. `Buffer.from(data)`) if you need to retain it beyond the callback. */
    onData?: (channel: EventloopChannel, data: Buffer) => void;
    /** Fired when the connection is closed (either end). */
    onClose?: (channel: EventloopChannel) => void;
    /** Fired on a socket-level error (the channel is implicitly closed). */
    onError?: (channel: EventloopChannel, error: Error) => void;
    /** Fired when the OS socket write buffer has drained; pending-byte counter resets. */
    onDrain?: (channel: EventloopChannel) => void;
}

/** Configuration for outbound buffering limits. */
export interface EventloopOptions {
    /**
     * Maximum number of bytes that may be pending (written to socket but not yet
     * confirmed drained) per channel.  Once exceeded, {@link EventloopChannel.write}
     * returns `false` until the next drain event.
     * Default: 256 KiB.
     */
    maxOutboundBytes?: number;
}

const DEFAULT_MAX_OUTBOUND = 256 * 1024;

// ─── EventloopChannel ─────────────────────────────────────────────────────────

/**
 * A single bounded TCP channel.  Wraps a Bun TCP socket and enforces an explicit
 * backpressure contract: {@link write} returns `false` rather than silently dropping
 * or infinitely buffering data.
 */
export class EventloopChannel {
    private readonly _socket: SocketWriter;
    private _closed = false;
    private _bytesRead = 0;
    private _bytesWritten = 0;
    /** Bytes written to socket.write() since the last drain event. */
    private _pendingBytes = 0;
    private readonly _maxOutbound: number;

    constructor(socket: SocketWriter, maxOutbound: number) {
        this._socket = socket;
        this._maxOutbound = maxOutbound;
    }

    /**
     * Write `data` to the channel.
     * @returns `true` if the data was accepted; `false` if:
     *   - the channel is already closed, or
     *   - adding `data.length` to the current pending counter would exceed
     *     {@link EventloopOptions.maxOutboundBytes} (explicit backpressure).
     */
    write(data: Buffer): boolean {
        if (this._closed) return false;
        if (this._pendingBytes + data.length > this._maxOutbound) return false;
        this._pendingBytes += data.length;
        this._socket.write(data);
        this._bytesWritten += data.length;
        return true;
    }

    /**
     * Half-close the channel.  Subsequent writes return `false`.
     * Idempotent — safe to call multiple times.
     */
    close(): void {
        if (!this._closed) {
            this._closed = true;
            this._socket.end();
        }
    }

    isClosed(): boolean { return this._closed; }
    bytesRead(): number { return this._bytesRead; }
    bytesWritten(): number { return this._bytesWritten; }

    // ── internal hooks (called by socket handlers) ────────────────────────

    /** @internal */
    _recordRead(n: number): void { this._bytesRead += n; }

    /**
     * Reset the pending-bytes counter.  Called by the socket `drain` event,
     * which signals that the OS write buffer has been fully flushed.
     * @internal
     */
    _onDrain(): void { this._pendingBytes = 0; }

    /** @internal */
    _markClosed(): void { this._closed = true; }
}

// ─── EventloopServer ─────────────────────────────────────────────────────────

/** Minimal interface for the Bun TCP listener we need. */
interface TCPListener {
    port: number;
    hostname: string;
    stop(closeActiveConnections?: boolean): void;
}

/**
 * Returned by {@link Eventloop.listen}.  Tracks active connections and allows
 * the listener to be shut down.
 */
export class EventloopServer {
    private readonly _listener: TCPListener;
    private readonly _connections = new Set<EventloopChannel>();

    constructor(listener: TCPListener) {
        this._listener = listener;
    }

    /** The actual port the server is listening on (useful when port 0 was requested). */
    port(): number { return this._listener.port; }
    hostname(): string { return this._listener.hostname; }
    connectionCount(): number { return this._connections.size; }

    /**
     * Stop the listener.
     * @param force If `true`, forcibly close all active connections immediately.
     */
    stop(force = false): void {
        this._listener.stop(force);
    }

    /** @internal */
    _add(ch: EventloopChannel): void { this._connections.add(ch); }
    /** @internal */
    _remove(ch: EventloopChannel): void { this._connections.delete(ch); }
}

// ─── internal socket-data type ────────────────────────────────────────────────

/** Attached to every Bun socket via socket.data. */
interface SocketData {
    channel: EventloopChannel;
    callbacks: EventloopCallbacks;
    server: EventloopServer | null;
}

// ─── shared socket event handlers ────────────────────────────────────────────

function onData(socket: { data: SocketData }, rawData: Buffer): void {
    socket.data.channel._recordRead(rawData.length);
    socket.data.callbacks.onData?.(socket.data.channel, rawData);
}

function onClose(socket: { data: SocketData }): void {
    socket.data.channel._markClosed();
    socket.data.server?._remove(socket.data.channel);
    socket.data.callbacks.onClose?.(socket.data.channel);
}

function onDrain(socket: { data: SocketData }): void {
    socket.data.channel._onDrain();
    socket.data.callbacks.onDrain?.(socket.data.channel);
}

function onError(socket: { data?: SocketData }, error: Error, fallback?: (err: Error) => void): void {
    if (socket.data) {
        socket.data.channel._markClosed();
        socket.data.server?._remove(socket.data.channel);
        socket.data.callbacks.onError?.(socket.data.channel, error);
    } else {
        fallback?.(error);
    }
}

// ─── Eventloop ────────────────────────────────────────────────────────────────

/**
 * Bun-native transport layer (replaces Java TPC engine).
 *
 * Usage:
 * ```ts
 * // Server:
 * const srv = Eventloop.listen(8080, '0.0.0.0', { onData: ... });
 *
 * // Client:
 * const ch = await Eventloop.connect(8080, '127.0.0.1', { onData: ... });
 * ch.write(Buffer.from('hello'));
 * ```
 */
export class Eventloop {
    private constructor() { /* static-only */ }

    /**
     * Start a TCP server.  Uses `Bun.listen()` which is synchronous.
     *
     * @param port  TCP port (0 = OS-assigned)
     * @param hostname  Bind address
     * @param callbacks  Event callbacks shared by all accepted connections
     * @param opts  Per-channel buffer limits
     */
    static listen(
        port: number,
        hostname: string,
        callbacks: EventloopCallbacks,
        opts?: EventloopOptions,
    ): EventloopServer {
        const maxOutbound = opts?.maxOutboundBytes ?? DEFAULT_MAX_OUTBOUND;

        // evServer is captured by the open() closure; assigned synchronously
        // after Bun.listen() returns — safe because open() only fires from
        // incoming connections, which happen after the current sync frame.
        let evServer!: EventloopServer;

        const listener = Bun.listen<SocketData>({
            hostname,
            port,
            socket: {
                open(socket) {
                    const ch = new EventloopChannel(socket as unknown as SocketWriter, maxOutbound);
                    socket.data = { channel: ch, callbacks, server: evServer };
                    evServer._add(ch);
                    callbacks.onConnect?.(ch);
                },
                data: onData,
                close: onClose,
                drain: onDrain,
                error(socket, error) { onError(socket, error); },
            },
        });

        evServer = new EventloopServer(listener);
        return evServer;
    }

    /**
     * Connect to a TCP server.  Resolves once the TCP handshake completes
     * (`open` fires) and the {@link EventloopChannel} is ready to write.
     *
     * @param port  Remote port
     * @param hostname  Remote host
     * @param callbacks  Event callbacks for this connection
     * @param opts  Per-channel buffer limits
     */
    static async connect(
        port: number,
        hostname: string,
        callbacks: EventloopCallbacks,
        opts?: EventloopOptions,
    ): Promise<EventloopChannel> {
        const maxOutbound = opts?.maxOutboundBytes ?? DEFAULT_MAX_OUTBOUND;

        let resolveChannel!: (ch: EventloopChannel) => void;
        let rejectChannel!: (err: Error) => void;
        const channelPromise = new Promise<EventloopChannel>((res, rej) => {
            resolveChannel = res;
            rejectChannel = rej;
        });

        Bun.connect<SocketData>({
            hostname,
            port,
            socket: {
                open(socket) {
                    const ch = new EventloopChannel(socket as unknown as SocketWriter, maxOutbound);
                    socket.data = { channel: ch, callbacks, server: null };
                    callbacks.onConnect?.(ch);
                    resolveChannel(ch);
                },
                data: onData,
                close: onClose,
                drain: onDrain,
                error(socket, error) {
                    onError(socket, error, rejectChannel);
                },
                connectError(_socket, error) {
                    rejectChannel(error);
                },
            },
        }).catch(rejectChannel);

        return channelPromise;
    }
}
