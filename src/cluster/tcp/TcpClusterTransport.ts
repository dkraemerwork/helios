/**
 * TCP-based cluster transport for Helios.
 *
 * Connects two or more Helios instances over real TCP sockets using the Bun-native
 * Eventloop adapter.  Provides a simple broadcast API so HeliosInstanceImpl can
 * replicate map operations and near-cache invalidations to every connected peer.
 *
 * Wire format:
 *   [4-byte big-endian uint32: JSON payload length][JSON payload bytes]
 *
 * Session handshake:
 *   On each new connection (inbound or outbound) both sides immediately send a
 *   HELLO message carrying their node ID.  Only after receiving HELLO is the
 *   channel moved into `_peers` and eligible for broadcasts.
 */
import { Eventloop, type EventloopChannel, type EventloopServer } from '@helios/internal/eventloop/Eventloop';
import type { ClusterMessage } from '@helios/cluster/tcp/ClusterMessage';

export class TcpClusterTransport {
    private readonly _nodeId: string;
    private _server: EventloopServer | null = null;

    /**
     * Confirmed peers: channels that have completed the HELLO handshake.
     * Keyed by the remote node's ID string.
     */
    private readonly _peers = new Map<string, EventloopChannel>();

    /**
     * Per-channel receive buffer: accumulates raw bytes until a complete
     * length-prefixed JSON frame can be extracted.
     */
    private readonly _buffers = new Map<EventloopChannel, Buffer>();

    // ── External callbacks (set by HeliosInstanceImpl) ────────────────────

    /** Fired when a peer sends MAP_PUT. */
    onRemotePut: (mapName: string, key: unknown, value: unknown) => void = () => {};
    /** Fired when a peer sends MAP_REMOVE. */
    onRemoteRemove: (mapName: string, key: unknown) => void = () => {};
    /** Fired when a peer sends MAP_CLEAR. */
    onRemoteClear: (mapName: string) => void = () => {};
    /** Fired when a peer sends INVALIDATE (near-cache invalidation). */
    onRemoteInvalidate: (mapName: string, key: unknown) => void = () => {};
    /** Fired when a peer successfully completes the HELLO handshake. */
    onPeerConnected: (nodeId: string) => void = () => {};
    /** Fired when a peer's channel is closed. */
    onPeerDisconnected: (nodeId: string) => void = () => {};

    constructor(nodeId: string) {
        this._nodeId = nodeId;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /**
     * Start the TCP listener.  Synchronous — returns immediately after binding.
     *
     * @param port  TCP port to listen on (0 = OS-assigned).
     * @param host  Bind address (e.g. '0.0.0.0' or '127.0.0.1').
     */
    start(port: number, host: string): void {
        this._server = Eventloop.listen(port, host, {
            onConnect: (ch) => this._onConnect(ch),
            onData: (ch, data) => this._onData(ch, data),
            onClose: (ch) => this._onClose(ch),
        });
    }

    /**
     * Connect to a remote peer.  Resolves once the TCP handshake completes
     * (but the HELLO handshake is still in flight at that point — wait for
     * `peerCount()` to increase if you need a fully-ready peer).
     */
    async connectToPeer(host: string, port: number): Promise<EventloopChannel> {
        const ch = await Eventloop.connect(port, host, {
            onConnect: (ch2) => this._onConnect(ch2),
            onData: (ch2, data) => this._onData(ch2, data),
            onClose: (ch2) => this._onClose(ch2),
        });
        return ch;
    }

    /**
     * Stop the server and close all peer channels.
     */
    shutdown(): void {
        for (const ch of this._peers.values()) {
            ch.close();
        }
        this._peers.clear();
        this._buffers.clear();
        this._server?.stop(true);
        this._server = null;
    }

    // ── Peer info ─────────────────────────────────────────────────────────

    /** Number of peers that have completed the HELLO handshake. */
    peerCount(): number {
        return this._peers.size;
    }

    /** The actual TCP port this server is bound to (useful when port 0 was requested). */
    boundPort(): number | null {
        return this._server?.port() ?? null;
    }

    // ── Broadcast API ─────────────────────────────────────────────────────

    broadcastPut(mapName: string, key: unknown, value: unknown): void {
        this._broadcast({ type: 'MAP_PUT', mapName, key, value });
    }

    broadcastRemove(mapName: string, key: unknown): void {
        this._broadcast({ type: 'MAP_REMOVE', mapName, key });
    }

    broadcastClear(mapName: string): void {
        this._broadcast({ type: 'MAP_CLEAR', mapName });
    }

    broadcastInvalidate(mapName: string, key: unknown): void {
        this._broadcast({ type: 'INVALIDATE', mapName, key });
    }

    // ── Internal ──────────────────────────────────────────────────────────

    private _broadcast(msg: ClusterMessage): void {
        for (const ch of this._peers.values()) {
            this._sendMsg(ch, msg);
        }
    }

    private _sendMsg(ch: EventloopChannel, msg: ClusterMessage): void {
        const json = JSON.stringify(msg);
        const jsonBuf = Buffer.from(json, 'utf8');
        const frame = Buffer.allocUnsafe(4 + jsonBuf.length);
        frame.writeUInt32BE(jsonBuf.length, 0);
        jsonBuf.copy(frame, 4);
        ch.write(frame);
    }

    private _onConnect(ch: EventloopChannel): void {
        this._buffers.set(ch, Buffer.alloc(0));
        // Immediately announce this node's identity
        this._sendMsg(ch, { type: 'HELLO', nodeId: this._nodeId });
    }

    private _onClose(ch: EventloopChannel): void {
        this._buffers.delete(ch);
        for (const [id, peerCh] of this._peers) {
            if (peerCh === ch) {
                this._peers.delete(id);
                this.onPeerDisconnected(id);
                break;
            }
        }
    }

    private _onData(ch: EventloopChannel, incoming: Buffer): void {
        // Copy incoming data (Eventloop docs: data view is only valid during callback)
        let buf = this._buffers.get(ch) ?? Buffer.alloc(0);
        buf = Buffer.concat([buf, Buffer.from(incoming)]);

        while (buf.length >= 4) {
            const msgLen = buf.readUInt32BE(0);
            if (buf.length < 4 + msgLen) break;

            const msgBytes = buf.subarray(4, 4 + msgLen);
            buf = buf.subarray(4 + msgLen);

            try {
                const msg = JSON.parse(msgBytes.toString('utf8')) as ClusterMessage;
                this._handleMsg(ch, msg);
            } catch {
                // Malformed frame — discard and continue
            }
        }

        this._buffers.set(ch, buf);
    }

    private _handleMsg(ch: EventloopChannel, msg: ClusterMessage): void {
        switch (msg.type) {
            case 'HELLO':
                this._peers.set(msg.nodeId, ch);
                this.onPeerConnected(msg.nodeId);
                break;

            case 'MAP_PUT':
                this.onRemotePut(msg.mapName, msg.key, msg.value);
                break;

            case 'MAP_REMOVE':
                this.onRemoteRemove(msg.mapName, msg.key);
                break;

            case 'MAP_CLEAR':
                this.onRemoteClear(msg.mapName);
                break;

            case 'INVALIDATE':
                this.onRemoteInvalidate(msg.mapName, msg.key);
                break;
        }
    }
}
