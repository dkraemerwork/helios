import { describe, expect, it, afterEach } from 'bun:test';
import { NatsServerManager } from '../../src/server/NatsServerManager.js';
import type { NatsServerNodeConfig } from '../../src/server/NatsServerConfig.js';
import { NatsServerBinaryResolver } from '../../src/server/NatsServerBinaryResolver.js';
import { connect } from '@nats-io/transport-node';
import { jetstreamManager } from '@nats-io/jetstream';

/** Helper to build a single-node in-memory config on a given port. */
function singleNodeConfig(port: number, overrides?: Partial<NatsServerNodeConfig>): NatsServerNodeConfig[] {
    return [{
        binaryPath: NatsServerBinaryResolver.resolve(),
        port,
        clusterPort: 0,
        dataDir: undefined,
        serverName: `test-node-${port}`,
        clusterName: undefined,
        routes: [],
        extraArgs: [],
        startTimeoutMs: 10_000,
        ...overrides,
    }];
}

/** Helper to build a 3-node cluster config. */
function clusterConfigs(basePort: number, baseClusterPort: number): NatsServerNodeConfig[] {
    const binaryPath = NatsServerBinaryResolver.resolve();
    const nodes = 3;
    const configs: NatsServerNodeConfig[] = [];
    for (let i = 0; i < nodes; i++) {
        const routes = [];
        for (let j = 0; j < nodes; j++) {
            if (j !== i) routes.push(`nats://127.0.0.1:${baseClusterPort + j}`);
        }
        configs.push({
            binaryPath,
            port: basePort + i,
            clusterPort: baseClusterPort + i,
            dataDir: `/tmp/blitz-cluster-test-${basePort}/node-${i}`,
            serverName: `cluster-node-${i}`,
            clusterName: 'test-cluster',
            routes,
            extraArgs: [],
            startTimeoutMs: 15_000,
        });
    }
    return configs;
}

describe('NatsServerManager', () => {
    const managers: NatsServerManager[] = [];

    afterEach(async () => {
        // Cleanup all spawned managers
        for (const m of managers) {
            try { await m.shutdown(); } catch { /* ignore */ }
        }
        managers.length = 0;
        // Clean up any cluster test directories
        const { rmSync } = await import('node:fs');
        for (const dir of ['/tmp/blitz-cluster-test-14230', '/tmp/blitz-cluster-test-14240']) {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it('spawn_singleNode_inMemory_becomesReachable', async () => {
        const manager = await NatsServerManager.spawn(singleNodeConfig(14222));
        managers.push(manager);

        expect(manager.clientUrls).toEqual(['nats://127.0.0.1:14222']);

        // Verify we can actually connect
        const nc = await connect({ servers: 'nats://127.0.0.1:14222', timeout: 2000 });
        await nc.close();
    }, 15_000);

    it('spawn_singleNode_persistent_storesData', async () => {
        const tmpDir = `/tmp/blitz-test-persistent-${Date.now()}`;
        const manager = await NatsServerManager.spawn(singleNodeConfig(14223, { dataDir: tmpDir }));
        managers.push(manager);

        // Write data to a KV store
        const nc = await connect({ servers: 'nats://127.0.0.1:14223', timeout: 2000 });
        const { Kvm } = await import('@nats-io/kv');
        const kvm = new Kvm(nc);
        const kv = await kvm.create('persist-test');
        await kv.put('key1', new TextEncoder().encode('value1'));
        await nc.close();

        // Shutdown and restart on same port with same dataDir
        await manager.shutdown();
        managers.length = 0;

        const manager2 = await NatsServerManager.spawn(singleNodeConfig(14223, { dataDir: tmpDir }));
        managers.push(manager2);

        const nc2 = await connect({ servers: 'nats://127.0.0.1:14223', timeout: 2000 });
        const kvm2 = new Kvm(nc2);
        const kv2 = await kvm2.open('persist-test');
        const entry = await kv2.get('key1');
        expect(new TextDecoder().decode(entry!.value)).toBe('value1');
        await nc2.close();

        // Cleanup tmpDir
        const { rmSync } = await import('node:fs');
        rmSync(tmpDir, { recursive: true, force: true });
    }, 30_000);

    it('spawn_multiNode_allNodesReachable', async () => {
        const manager = await NatsServerManager.spawn(clusterConfigs(14230, 16230));
        managers.push(manager);

        expect(manager.clientUrls).toHaveLength(3);

        // Verify all nodes are connectable
        for (const url of manager.clientUrls) {
            const nc = await connect({ servers: url, timeout: 2000 });
            await nc.close();
        }
    }, 30_000);

    it('shutdown_killsAllProcesses', async () => {
        const manager = await NatsServerManager.spawn(singleNodeConfig(14224));
        await manager.shutdown();

        // After shutdown, connecting should fail
        await expect(
            connect({ servers: 'nats://127.0.0.1:14224', timeout: 1000 }),
        ).rejects.toThrow();
    }, 15_000);

    it('shutdown_isIdempotent', async () => {
        const manager = await NatsServerManager.spawn(singleNodeConfig(14225));
        await manager.shutdown();
        // Second shutdown should not throw
        await manager.shutdown();
    }, 15_000);

    it('shutdown_portsReleasedBeforeResolves', async () => {
        // N15 test: spawn → shutdown → spawn again on same port — no EADDRINUSE
        const manager1 = await NatsServerManager.spawn(singleNodeConfig(14226));
        await manager1.shutdown();

        const manager2 = await NatsServerManager.spawn(singleNodeConfig(14226));
        managers.push(manager2);

        const nc = await connect({ servers: 'nats://127.0.0.1:14226', timeout: 2000 });
        await nc.close();
    }, 20_000);

    it('waitUntilReady_timeoutExceeded_throws', async () => {
        // Spawn a binary that exits immediately (bash -c exit) so the port is never bound
        const configs: NatsServerNodeConfig[] = [{
            binaryPath: '/bin/sh',
            port: 14227,
            clusterPort: 0,
            dataDir: undefined,
            serverName: 'timeout-test',
            clusterName: undefined,
            routes: [],
            extraArgs: ['-c', 'sleep 10'],
            startTimeoutMs: 500,
        }];

        await expect(NatsServerManager.spawn(configs)).rejects.toThrow(/did not start within/);
    }, 10_000);

    it('spawn_cluster_jetStreamReadyBeforeReturn', async () => {
        // N14 integration test: after spawn(), jsm.info() succeeds immediately
        const manager = await NatsServerManager.spawn(clusterConfigs(14240, 16240));
        managers.push(manager);

        const nc = await connect({ servers: manager.clientUrls[0], timeout: 2000 });
        const jsm = await jetstreamManager(nc);
        // This should NOT throw — JetStream must be ready when spawn() returns
        const info = await jsm.getAccountInfo();
        expect(info).toBeDefined();
        await nc.close();
    }, 30_000);

    // --- _buildArgs unit tests ---

    it('buildArgs_inMemory_noStoreDirFlag', () => {
        const args = NatsServerManager.buildArgs({
            binaryPath: '/bin/nats-server',
            port: 4222,
            clusterPort: 0,
            dataDir: undefined,
            serverName: 'test',
            clusterName: undefined,
            routes: [],
            extraArgs: [],
            startTimeoutMs: 10_000,
        });
        expect(args).toContain('-js');
        expect(args).not.toContain('-sd');
    });

    it('buildArgs_persistent_containsStoreDirFlag', () => {
        const args = NatsServerManager.buildArgs({
            binaryPath: '/bin/nats-server',
            port: 4222,
            clusterPort: 0,
            dataDir: '/data/test',
            serverName: 'test',
            clusterName: undefined,
            routes: [],
            extraArgs: [],
            startTimeoutMs: 10_000,
        });
        expect(args).toContain('-js');
        expect(args).toContain('-sd');
        expect(args).toContain('/data/test');
    });

    it('buildArgs_clusterNode_containsRoutesAndClusterFlags', () => {
        const args = NatsServerManager.buildArgs({
            binaryPath: '/bin/nats-server',
            port: 4222,
            clusterPort: 6222,
            dataDir: undefined,
            serverName: 'node-0',
            clusterName: 'test-cluster',
            routes: ['nats://127.0.0.1:6223', 'nats://127.0.0.1:6224'],
            extraArgs: [],
            startTimeoutMs: 10_000,
        });
        expect(args).toContain('--cluster');
        expect(args).toContain('nats://0.0.0.0:6222');
        expect(args).toContain('--cluster_name');
        expect(args).toContain('test-cluster');
        expect(args).toContain('--routes');
    });

    it('buildArgs_extraArgs_appended', () => {
        const args = NatsServerManager.buildArgs({
            binaryPath: '/bin/nats-server',
            port: 4222,
            clusterPort: 0,
            dataDir: undefined,
            serverName: 'test',
            clusterName: undefined,
            routes: [],
            extraArgs: ['--trace', '--debug'],
            startTimeoutMs: 10_000,
        });
        expect(args).toContain('--trace');
        expect(args).toContain('--debug');
    });

    it('clientUrls_matchesSpawnedPorts', async () => {
        const manager = await NatsServerManager.spawn(singleNodeConfig(14228));
        managers.push(manager);
        expect(manager.clientUrls).toEqual(['nats://127.0.0.1:14228']);
    }, 15_000);

    it('spawn_singleNode_jetStreamAvailable', async () => {
        const manager = await NatsServerManager.spawn(singleNodeConfig(14229));
        managers.push(manager);

        const nc = await connect({ servers: 'nats://127.0.0.1:14229', timeout: 2000 });
        const jsm = await jetstreamManager(nc);
        const info = await jsm.getAccountInfo();
        expect(info).toBeDefined();
        await nc.close();
    }, 15_000);
});
