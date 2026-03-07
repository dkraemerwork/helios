import { jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { afterEach, describe, expect, test } from 'bun:test';
import {
    clusterNode,
    DEFAULT_REPLICAS,
    normalizeRoutes,
    resolveClusterNodeConfig,
    toNodeConfig,
    validateClusterNodeConfig,
} from '../../src/server/ClusterNodeConfig.ts';
import type { NatsServerNodeConfig } from '../../src/server/NatsServerConfig.ts';
import { NatsServerManager } from '../../src/server/NatsServerManager.ts';

describe('ClusterNodeNatsConfig types and resolution', () => {
    test('resolveClusterNodeConfig applies all defaults', () => {
        const resolved = resolveClusterNodeConfig({});
        expect(resolved.bindHost).toBe('127.0.0.1');
        expect(resolved.advertiseHost).toBe('127.0.0.1');
        expect(resolved.port).toBe(4222);
        expect(resolved.clusterPort).toBe(6222);
        expect(resolved.clusterName).toBe('helios-blitz-cluster');
        expect(resolved.serverName).toMatch(/^helios-blitz-/);
        expect(resolved.routes).toEqual([]);
        expect(resolved.replicas).toBe(DEFAULT_REPLICAS);
        expect(resolved.dataDir).toBeUndefined();
        expect(resolved.startTimeoutMs).toBe(15_000);
    });

    test('resolveClusterNodeConfig preserves explicit values', () => {
        const resolved = resolveClusterNodeConfig({
            bindHost: '0.0.0.0',
            advertiseHost: '10.0.1.5',
            port: 5222,
            clusterPort: 7222,
            clusterName: 'my-cluster',
            serverName: 'node-alpha',
            routes: ['nats://10.0.1.6:7222'],
            replicas: 3,
            dataDir: '/data/nats',
            startTimeoutMs: 30_000,
        });
        expect(resolved.bindHost).toBe('0.0.0.0');
        expect(resolved.advertiseHost).toBe('10.0.1.5');
        expect(resolved.port).toBe(5222);
        expect(resolved.clusterPort).toBe(7222);
        expect(resolved.clusterName).toBe('my-cluster');
        expect(resolved.serverName).toBe('node-alpha');
        expect(resolved.routes).toEqual(['nats://10.0.1.6:7222']);
        expect(resolved.replicas).toBe(3);
        expect(resolved.dataDir).toBe('/data/nats');
        expect(resolved.startTimeoutMs).toBe(30_000);
    });

    test('DEFAULT_REPLICAS matches Hazelcast default backup count of 1', () => {
        expect(DEFAULT_REPLICAS).toBe(1);
    });
});

describe('normalizeRoutes', () => {
    test('sorts routes lexicographically for determinism', () => {
        const routes = [
            'nats://10.0.1.3:6222',
            'nats://10.0.1.1:6222',
            'nats://10.0.1.2:6222',
        ];
        const normalized = normalizeRoutes(routes);
        expect(normalized).toEqual([
            'nats://10.0.1.1:6222',
            'nats://10.0.1.2:6222',
            'nats://10.0.1.3:6222',
        ]);
    });

    test('deduplicates identical routes', () => {
        const routes = [
            'nats://10.0.1.1:6222',
            'nats://10.0.1.1:6222',
            'nats://10.0.1.2:6222',
        ];
        expect(normalizeRoutes(routes)).toEqual([
            'nats://10.0.1.1:6222',
            'nats://10.0.1.2:6222',
        ]);
    });

    test('returns empty array for empty input', () => {
        expect(normalizeRoutes([])).toEqual([]);
    });

    test('produces same output regardless of input order', () => {
        const a = normalizeRoutes(['nats://b:6222', 'nats://a:6222', 'nats://c:6222']);
        const b = normalizeRoutes(['nats://c:6222', 'nats://a:6222', 'nats://b:6222']);
        expect(a).toEqual(b);
    });
});

describe('validateClusterNodeConfig', () => {
    test('throws when port equals clusterPort', () => {
        expect(() =>
            validateClusterNodeConfig(resolveClusterNodeConfig({ port: 4222, clusterPort: 4222 })),
        ).toThrow(/client port.*cluster port.*overlap/i);
    });

    test('throws when bindHost is empty', () => {
        expect(() =>
            validateClusterNodeConfig(resolveClusterNodeConfig({ bindHost: '' })),
        ).toThrow(/bindHost/i);
    });

    test('throws when advertiseHost is empty', () => {
        expect(() =>
            validateClusterNodeConfig(resolveClusterNodeConfig({ advertiseHost: '' })),
        ).toThrow(/advertiseHost/i);
    });

    test('throws when routes contain malformed URLs', () => {
        expect(() =>
            validateClusterNodeConfig(resolveClusterNodeConfig({ routes: ['not-a-url'] })),
        ).toThrow(/route.*invalid/i);
    });

    test('throws when replicas < 1', () => {
        expect(() =>
            validateClusterNodeConfig(resolveClusterNodeConfig({ replicas: 0 })),
        ).toThrow(/replicas/i);
    });

    test('throws when port is out of valid range', () => {
        expect(() =>
            validateClusterNodeConfig(resolveClusterNodeConfig({ port: 0 })),
        ).toThrow(/port/i);
    });

    test('passes for valid default config', () => {
        expect(() =>
            validateClusterNodeConfig(resolveClusterNodeConfig({})),
        ).not.toThrow();
    });

    test('passes for valid config with routes', () => {
        expect(() =>
            validateClusterNodeConfig(
                resolveClusterNodeConfig({ routes: ['nats://10.0.1.2:6222'] }),
            ),
        ).not.toThrow();
    });
});

describe('toNodeConfig conversion', () => {
    test('produces valid NatsServerNodeConfig', () => {
        const resolved = resolveClusterNodeConfig({
            bindHost: '0.0.0.0',
            advertiseHost: '10.0.1.5',
            port: 5222,
            clusterPort: 7222,
            clusterName: 'test-cluster',
            serverName: 'node-0',
            routes: ['nats://10.0.1.6:7222'],
            dataDir: '/tmp/test',
        });
        const nodeConfig = toNodeConfig(resolved);
        expect(nodeConfig.port).toBe(5222);
        expect(nodeConfig.clusterPort).toBe(7222);
        expect(nodeConfig.clusterName).toBe('test-cluster');
        expect(nodeConfig.serverName).toBe('node-0');
        expect(nodeConfig.routes).toEqual(['nats://10.0.1.6:7222']);
        expect(nodeConfig.dataDir).toBe('/tmp/test');
        expect(nodeConfig.bindHost).toBe('0.0.0.0');
        expect(nodeConfig.advertiseHost).toBe('10.0.1.5');
    });
});

describe('NatsServerManager.buildArgs with bind/advertise', () => {
    test('includes --client_advertise when advertiseHost differs from bindHost', () => {
        const config: NatsServerNodeConfig = {
            binaryPath: '/usr/bin/nats-server',
            port: 4222,
            clusterPort: 6222,
            dataDir: undefined,
            serverName: 'node-0',
            clusterName: 'test',
            routes: [],
            extraArgs: [],
            startTimeoutMs: 10_000,
            bindHost: '0.0.0.0',
            advertiseHost: '10.0.1.5',
        };
        const args = NatsServerManager.buildArgs(config);
        expect(args).toContain('--client_advertise');
        const advIdx = args.indexOf('--client_advertise');
        expect(args[advIdx + 1]).toBe('10.0.1.5:4222');
    });

    test('uses bindHost in --cluster flag and adds --cluster_advertise', () => {
        const config: NatsServerNodeConfig = {
            binaryPath: '/usr/bin/nats-server',
            port: 4222,
            clusterPort: 6222,
            dataDir: undefined,
            serverName: 'node-0',
            clusterName: 'test',
            routes: ['nats://10.0.1.2:6222'],
            extraArgs: [],
            startTimeoutMs: 10_000,
            bindHost: '0.0.0.0',
            advertiseHost: '10.0.1.5',
        };
        const args = NatsServerManager.buildArgs(config);
        const clusterIdx = args.indexOf('--cluster');
        expect(args[clusterIdx + 1]).toBe('nats://0.0.0.0:6222');
        expect(args).toContain('--cluster_advertise');
        const advIdx = args.indexOf('--cluster_advertise');
        expect(args[advIdx + 1]).toBe('10.0.1.5:6222');
    });

    test('omits advertise flags when bindHost equals advertiseHost', () => {
        const config: NatsServerNodeConfig = {
            binaryPath: '/usr/bin/nats-server',
            port: 4222,
            clusterPort: 6222,
            dataDir: undefined,
            serverName: 'node-0',
            clusterName: 'test',
            routes: [],
            extraArgs: [],
            startTimeoutMs: 10_000,
            bindHost: '127.0.0.1',
            advertiseHost: '127.0.0.1',
        };
        const args = NatsServerManager.buildArgs(config);
        expect(args).not.toContain('--client_advertise');
        expect(args).not.toContain('--cluster_advertise');
    });
});

describe('clusterNode one-local-node spawn (integration)', () => {
    let manager: NatsServerManager | null = null;

    afterEach(async () => {
        if (manager) {
            await manager.shutdown();
            manager = null;
        }
    });

    test('spawns a single clustered node that is connectable', async () => {
        manager = await clusterNode({ clusterName: 'integration-test', port: 14222, clusterPort: 16222 });
        expect(manager.clientUrls.length).toBe(1);
        expect(manager.clientUrls[0]).toMatch(/^nats:\/\//);

        const nc = await connect({ servers: manager.clientUrls[0], timeout: 5_000 });
        try {
            expect(nc.isClosed()).toBe(false);
        } finally {
            await nc.close();
        }
    }, 20_000);

    test('spawned clustered node has JetStream enabled', async () => {
        manager = await clusterNode({ port: 14223, clusterPort: 16223 });
        const nc = await connect({ servers: manager.clientUrls[0], timeout: 5_000 });
        try {
            const jsm = await jetstreamManager(nc);
            const info = await jsm.getAccountInfo();
            expect(info).toBeDefined();
        } finally {
            await nc.close();
        }
    }, 20_000);

    test('clusterNode applies defaultReplicas in resolved config', async () => {
        manager = await clusterNode({ port: 14224, clusterPort: 16224 });
        expect(manager.resolvedConfig).toBeDefined();
        expect(manager.resolvedConfig!.replicas).toBe(DEFAULT_REPLICAS);
    }, 20_000);
});
