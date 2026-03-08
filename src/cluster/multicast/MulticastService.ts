/**
 * MulticastService — UDP multicast sender/receiver for cluster discovery.
 *
 * Port of {@code com.hazelcast.internal.cluster.impl.MulticastService}.
 *
 * Creates a UDP multicast socket, joins the configured multicast group, and
 * runs a receive loop that dispatches incoming {@link MulticastMessage}
 * objects to registered {@link MulticastListener}s. Also provides a
 * thread-safe send method for broadcasting join messages.
 *
 * Wire format (safe mode — always used, no Java serialization equivalent):
 *   [1 byte: version][2 bytes BE uint16: JSON payload length][JSON payload bytes]
 *
 * The JSON payload is a {@link MulticastMessage} discriminated union.
 */
import type { MulticastConfig } from '@zenystx/helios-core/config/MulticastConfig';
import dgram from 'node:dgram';

// ── Wire constants ────────────────────────────────────────────────────────

/** Protocol version byte — increment when wire format changes. */
const PROTOCOL_VERSION = 1;

/** Maximum datagram size (64 KiB). */
const DATAGRAM_BUFFER_SIZE = 64 * 1024;

/** Socket receive timeout fallback (ms). */
const DEFAULT_SOCKET_TIMEOUT = 1000;

// ── Message types ─────────────────────────────────────────────────────────

export interface MulticastJoinMessage {
    readonly type: 'JOIN';
    readonly address: { readonly host: string; readonly port: number };
    readonly uuid: string;
    readonly clusterName: string;
    readonly partitionCount: number;
    readonly version: { readonly major: number; readonly minor: number; readonly patch: number };
    readonly liteMember: boolean;
}

export interface MulticastJoinRequest extends MulticastJoinMessage {
    readonly type: 'JOIN';
    readonly isRequest: true;
    readonly tryCount: number;
}

export interface MulticastSplitBrainMessage {
    readonly type: 'SPLIT_BRAIN';
    readonly address: { readonly host: string; readonly port: number };
    readonly uuid: string;
    readonly clusterName: string;
    readonly memberCount: number;
}

export type MulticastMessage =
    | MulticastJoinMessage
    | MulticastJoinRequest
    | MulticastSplitBrainMessage;

// ── Listener interface ────────────────────────────────────────────────────

export interface MulticastListener {
    onMessage(msg: MulticastMessage): void;
}

// ── Address trust checker ─────────────────────────────────────────────────

function isTrusted(address: string, trustedInterfaces: ReadonlySet<string>): boolean {
    if (trustedInterfaces.size === 0) return true;
    for (const pattern of trustedInterfaces) {
        if (pattern === '*') return true;
        // Simple wildcard matching (e.g. "192.168.1.*")
        const regex = new RegExp(
            '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
        );
        if (regex.test(address)) return true;
    }
    return false;
}

// ── Serialization helpers ─────────────────────────────────────────────────

function serializeMessage(msg: MulticastMessage): Buffer {
    const json = JSON.stringify(msg);
    const jsonBytes = Buffer.from(json, 'utf8');
    const frame = Buffer.allocUnsafe(1 + 2 + jsonBytes.length);
    frame.writeUInt8(PROTOCOL_VERSION, 0);
    frame.writeUInt16BE(jsonBytes.length, 1);
    jsonBytes.copy(frame, 3);
    return frame;
}

function deserializeMessage(data: Buffer): MulticastMessage | null {
    if (data.length < 3) return null;
    const version = data.readUInt8(0);
    if (version !== PROTOCOL_VERSION) return null;
    const jsonLen = data.readUInt16BE(1);
    if (data.length < 3 + jsonLen) return null;
    const jsonStr = data.subarray(3, 3 + jsonLen).toString('utf8');
    return JSON.parse(jsonStr) as MulticastMessage;
}

// ── MulticastService ──────────────────────────────────────────────────────

export class MulticastService {
    private readonly _socket: dgram.Socket;
    private readonly _listeners: MulticastListener[] = [];
    private readonly _multicastGroup: string;
    private readonly _multicastPort: number;
    private readonly _trustedInterfaces: ReadonlySet<string>;
    private _running = false;
    private _readyResolve: (() => void) | null = null;
    private readonly _readyPromise: Promise<void>;

    private constructor(
        socket: dgram.Socket,
        multicastGroup: string,
        multicastPort: number,
        trustedInterfaces: ReadonlySet<string>,
    ) {
        this._socket = socket;
        this._multicastGroup = multicastGroup;
        this._multicastPort = multicastPort;
        this._trustedInterfaces = trustedInterfaces;
        this._readyPromise = new Promise<void>((resolve) => {
            this._readyResolve = resolve;
        });
    }

    /**
     * Create and configure a MulticastService from the given config.
     * Returns null if multicast is disabled.
     *
     * Mirrors: {@code MulticastService.createMulticastService()} in Hazelcast.
     */
    static create(config: MulticastConfig): MulticastService | null {
        if (!config.isEnabled()) return null;

        const group = config.getMulticastGroup();
        const port = config.getMulticastPort();
        const ttl = config.getMulticastTimeToLive();
        const trustedInterfaces = config.getTrustedInterfaces();
        const loopbackMode = config.getLoopbackModeEnabled();

        const socket = dgram.createSocket({
            type: 'udp4',
            reuseAddr: true,
        });

        const service = new MulticastService(socket, group, port, trustedInterfaces);

        socket.bind(port, () => {
            socket.setMulticastTTL(ttl);
            socket.addMembership(group);

            if (loopbackMode !== null) {
                socket.setMulticastLoopback(loopbackMode);
            }

            // Increase buffer sizes
            try {
                socket.setRecvBufferSize(DATAGRAM_BUFFER_SIZE);
                socket.setSendBufferSize(DATAGRAM_BUFFER_SIZE);
            } catch {
                // Some platforms don't support setting buffer sizes
            }

            service._readyResolve?.();
        });

        return service;
    }

    /**
     * Create a MulticastService with raw parameters (useful for testing).
     */
    static createWithParams(params: {
        group: string;
        port: number;
        ttl?: number;
        loopback?: boolean;
        trustedInterfaces?: ReadonlySet<string>;
    }): MulticastService {
        const socket = dgram.createSocket({
            type: 'udp4',
            reuseAddr: true,
        });

        const service = new MulticastService(
            socket,
            params.group,
            params.port,
            params.trustedInterfaces ?? new Set(),
        );

        socket.bind(params.port, () => {
            socket.setMulticastTTL(params.ttl ?? 32);
            socket.addMembership(params.group);

            if (params.loopback !== undefined) {
                socket.setMulticastLoopback(params.loopback);
            }

            try {
                socket.setRecvBufferSize(DATAGRAM_BUFFER_SIZE);
                socket.setSendBufferSize(DATAGRAM_BUFFER_SIZE);
            } catch {
                // Some platforms don't support setting buffer sizes
            }

            service._readyResolve?.();
        });

        return service;
    }

    /**
     * Start the receive loop. Incoming messages are dispatched to registered listeners.
     */
    start(): void {
        if (this._running) return;
        this._running = true;

        this._socket.on('message', (data: Buffer, rinfo: dgram.RemoteInfo) => {
            if (!this._running) return;

            // Trust check on source address
            if (!isTrusted(rinfo.address, this._trustedInterfaces)) return;

            try {
                const msg = deserializeMessage(data);
                if (msg === null) return;

                for (const listener of this._listeners) {
                    try {
                        listener.onMessage(msg);
                    } catch {
                        // Listener error — suppress and continue
                    }
                }
            } catch {
                // Malformed datagram — silently discard
            }
        });

        this._socket.on('error', () => {
            // Socket error — suppress (will be cleaned up on stop)
        });
    }

    /**
     * Send a multicast message to the configured group.
     *
     * Mirrors: {@code MulticastService.send()} in Hazelcast.
     */
    send(msg: MulticastMessage): void {
        if (!this._running) return;

        const frame = serializeMessage(msg);
        this._socket.send(
            frame,
            0,
            frame.length,
            this._multicastPort,
            this._multicastGroup,
            (err) => {
                if (err) {
                    // Sending failed — EPERM or similar; log and continue
                    // See: https://github.com/hazelcast/hazelcast/issues/7198
                }
            },
        );
    }

    /**
     * Register a listener for incoming multicast messages.
     */
    addMulticastListener(listener: MulticastListener): void {
        this._listeners.push(listener);
    }

    /**
     * Remove a previously registered listener.
     */
    removeMulticastListener(listener: MulticastListener): void {
        const idx = this._listeners.indexOf(listener);
        if (idx !== -1) this._listeners.splice(idx, 1);
    }

    /**
     * Stop the service and close the socket.
     */
    stop(): void {
        if (!this._running) return;
        this._running = false;

        try {
            this._socket.dropMembership(this._multicastGroup);
        } catch {
            // Already left or socket closed
        }

        try {
            this._socket.close();
        } catch {
            // Already closed
        }
    }

    /**
     * Whether the service is currently running.
     */
    isRunning(): boolean {
        return this._running;
    }

    /**
     * Returns the multicast group address.
     */
    getMulticastGroup(): string {
        return this._multicastGroup;
    }

    /**
     * Returns the multicast port.
     */
    getMulticastPort(): number {
        return this._multicastPort;
    }

    /**
     * Returns a promise that resolves when the socket is bound and ready.
     * Must be awaited before calling send() to ensure addMembership() has completed.
     */
    waitForReady(): Promise<void> {
        return this._readyPromise;
    }
}
