import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstreamManager } from '@nats-io/jetstream';
import type { NatsServerNodeConfig } from './NatsServerConfig.js';
import type { ResolvedClusterNodeNatsConfig } from './ClusterNodeConfig.ts';

/**
 * Owns the full lifecycle of one or more `nats-server` child processes.
 *
 * Spawn → health-poll → (optional cluster JetStream readiness poll) → ready.
 * Shutdown → SIGTERM all processes → await exit → ports released.
 */
export class NatsServerManager {
    private readonly _processes: ReturnType<typeof Bun.spawn>[] = [];
    private readonly _clientUrls: string[];

    /** Resolved cluster-node config, set when spawned via `clusterNode()`. */
    resolvedConfig: ResolvedClusterNodeNatsConfig | null = null;

    private constructor(clientUrls: string[]) {
        this._clientUrls = clientUrls;
    }

    /** URLs to pass to BlitzService.connect() after spawn. */
    get clientUrls(): string[] {
        return this._clientUrls;
    }

    /**
     * Spawn one or more nats-server processes, wait until all are healthy,
     * and — for cluster mode — wait until JetStream is operational (Raft leader elected).
     *
     * @throws Error if servers do not become reachable within startTimeoutMs.
     * @throws Error if JetStream cluster does not elect a leader within startTimeoutMs.
     */
    static async spawn(configs: NatsServerNodeConfig[]): Promise<NatsServerManager> {
        const clientUrls = configs.map(c => `nats://127.0.0.1:${c.port}`);
        const manager = new NatsServerManager(clientUrls);

        // Spawn all processes
        for (const config of configs) {
            const args = NatsServerManager.buildArgs(config);
            const proc = Bun.spawn([config.binaryPath, ...args], {
                stdout: 'ignore',
                stderr: 'ignore',
            });
            manager._processes.push(proc);
        }

        // Wait until all nodes are TCP-connectable
        await Promise.all(
            configs.map(c => NatsServerManager._waitUntilReady(c.port, c.startTimeoutMs)),
        );

        // N14 FIX: For cluster mode, wait until JetStream is operational (Raft leader elected)
        if (configs.length > 1) {
            const timeoutMs = configs[0].startTimeoutMs;
            await NatsServerManager._waitUntilJetStreamReady(configs[0].port, timeoutMs);
        }

        return manager;
    }

    /**
     * Kill all managed nats-server processes and wait for them to exit.
     *
     * N15 FIX: async — `await proc.exited` blocks until the OS confirms exit and port is free.
     * No-op if already shut down.
     */
    async shutdown(): Promise<void> {
        if (this._processes.length === 0) return;

        const procs = [...this._processes];
        this._processes.length = 0; // clear before await to make method idempotent

        await Promise.all(procs.map(async (proc) => {
            proc.kill();
            await proc.exited;
        }));
    }

    /** Build the CLI args array for a single nats-server node. @internal — exposed for testing */
    static buildArgs(config: NatsServerNodeConfig): string[] {
        const bindHost = config.bindHost ?? '0.0.0.0';
        const advertiseHost = config.advertiseHost;
        const args = ['-p', String(config.port), '-n', config.serverName, '-js'];

        if (config.dataDir) {
            args.push('-sd', config.dataDir);
        }

        // Client advertise — when advertiseHost differs from bindHost
        if (advertiseHost && advertiseHost !== bindHost) {
            args.push('--client_advertise', `${advertiseHost}:${config.port}`);
        }

        // Only enable NATS clustering when there are actual routes to connect to.
        // A single bootstrap node runs JetStream in standalone mode and becomes
        // cluster-ready when routes are provided on restart/rejoin.
        if (config.clusterPort > 0 && config.clusterName && config.routes.length > 0) {
            args.push(
                '--cluster', `nats://${bindHost}:${config.clusterPort}`,
                '--cluster_name', config.clusterName,
            );
            // Cluster advertise — when advertiseHost is set and differs from bindHost
            if (advertiseHost && advertiseHost !== bindHost) {
                args.push('--cluster_advertise', `${advertiseHost}:${config.clusterPort}`);
            }
            args.push('--routes', config.routes.join(','));
        }

        args.push(...config.extraArgs);
        return args;
    }

    /**
     * Poll nats://127.0.0.1:{port} until TCP-connectable or timeout.
     * N13 FIX: always close probe connections in finally block.
     */
    private static async _waitUntilReady(port: number, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            let nc: NatsConnection | null = null;
            try {
                nc = await connect({ servers: `nats://127.0.0.1:${port}`, timeout: 500 });
                return; // success — nc.close() in finally
            } catch {
                // server not ready yet — sleep and retry
                await Bun.sleep(100);
            } finally {
                // N13 FIX: always close, even on success (idempotent) or partial-open
                if (nc != null) {
                    try { await nc.close(); } catch { /* ignore close error */ }
                }
            }
        }
        throw new Error(`nats-server on port ${port} did not start within ${timeoutMs}ms`);
    }

    /**
     * N14 FIX: Poll JetStream on the given port until `jsm.getAccountInfo()` succeeds
     * (indicating a Raft leader has been elected and JetStream is operational).
     * Only called for cluster configs (configs.length > 1).
     */
    private static async _waitUntilJetStreamReady(port: number, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            let nc: NatsConnection | null = null;
            try {
                nc = await connect({ servers: `nats://127.0.0.1:${port}`, timeout: 500 });
                const jsm = await jetstreamManager(nc);
                await jsm.getAccountInfo(); // throws if no leader yet
                return; // JetStream is operational
            } catch {
                await Bun.sleep(200); // longer sleep — leader election takes time
            } finally {
                if (nc != null) {
                    try { await nc.close(); } catch { /* ignore */ }
                }
            }
        }
        throw new Error(
            `NATS JetStream cluster on port ${port} did not elect a leader within ${timeoutMs}ms`,
        );
    }
}
