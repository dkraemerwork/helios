/**
 * TCP fault injection proxy for transport-boundary testing.
 *
 * Sits between two Helios members as a transparent TCP proxy that can:
 * - Drop packets in either direction
 * - Inject delays on forwarded traffic
 * - Sever the connection (simulating network partition)
 * - Record traffic volume for verification
 *
 * Block 21.4: Enables transport-boundary crash/drop/delay injection.
 */

interface ProxyOptions {
    /** Local port the proxy listens on. */
    listenPort: number;
    /** Target host to forward to. */
    targetHost: string;
    /** Target port to forward to. */
    targetPort: number;
}

type FaultMode = 'passthrough' | 'drop-all' | 'delay';

export class TcpFaultProxy {
    private readonly _listenPort: number;
    private readonly _targetHost: string;
    private readonly _targetPort: number;
    private _server: any = null;
    private _faultMode: FaultMode = 'passthrough';
    private _delayMs = 0;
    private _connections: Set<{ clientSocket: any; targetSocket: any }> = new Set();
    bytesForwarded = 0;

    constructor(opts: ProxyOptions) {
        this._listenPort = opts.listenPort;
        this._targetHost = opts.targetHost;
        this._targetPort = opts.targetPort;
    }

    async start(): Promise<void> {
        this._server = Bun.listen({
            hostname: '127.0.0.1',
            port: this._listenPort,
            socket: {
                open: async (clientSocket) => {
                    // Connect to target
                    const targetSocket = await Bun.connect({
                        hostname: this._targetHost,
                        port: this._targetPort,
                        socket: {
                            data: (_sock, data) => {
                                // Target → Client
                                if (this._faultMode === 'drop-all') return;
                                if (this._faultMode === 'delay') {
                                    setTimeout(() => {
                                        try { clientSocket.write(data); } catch {}
                                    }, this._delayMs);
                                } else {
                                    clientSocket.write(data);
                                }
                                this.bytesForwarded += data.byteLength;
                            },
                            close: () => {
                                try { clientSocket.end(); } catch {}
                            },
                            error: () => {
                                try { clientSocket.end(); } catch {}
                            },
                            open: () => {},
                        },
                    });

                    const conn = { clientSocket, targetSocket };
                    this._connections.add(conn);
                    (clientSocket as any).__proxyConn = conn;
                },
                data: (clientSocket, data) => {
                    // Client → Target
                    const conn = (clientSocket as any).__proxyConn;
                    if (!conn) return;
                    if (this._faultMode === 'drop-all') return;
                    if (this._faultMode === 'delay') {
                        setTimeout(() => {
                            try { conn.targetSocket.write(data); } catch {}
                        }, this._delayMs);
                    } else {
                        conn.targetSocket.write(data);
                    }
                    this.bytesForwarded += data.byteLength;
                },
                close: (clientSocket) => {
                    const conn = (clientSocket as any).__proxyConn;
                    if (conn) {
                        try { conn.targetSocket.end(); } catch {}
                        this._connections.delete(conn);
                    }
                },
                error: () => {},
            },
        });
    }

    /** Set fault mode to drop all traffic. */
    dropAll(): void {
        this._faultMode = 'drop-all';
    }

    /** Set fault mode to delay all traffic by the given milliseconds. */
    delay(ms: number): void {
        this._faultMode = 'delay';
        this._delayMs = ms;
    }

    /** Resume normal passthrough. */
    passthrough(): void {
        this._faultMode = 'passthrough';
    }

    /** Sever all current connections (simulates network partition). */
    sever(): void {
        for (const conn of this._connections) {
            try { conn.clientSocket.end(); } catch {}
            try { conn.targetSocket.end(); } catch {}
        }
        this._connections.clear();
    }

    /** Stop the proxy server. */
    stop(): void {
        this.sever();
        if (this._server) {
            this._server.stop();
            this._server = null;
        }
    }
}
