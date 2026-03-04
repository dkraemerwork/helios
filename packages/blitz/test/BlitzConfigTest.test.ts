/**
 * BlitzConfig unit tests — no NATS server required.
 *
 * Tests default value application and config validation.
 */
import { describe, it, expect } from 'bun:test';
import { resolveBlitzConfig, type BlitzConfig } from '../src/BlitzConfig.ts';

describe('BlitzConfig', () => {
    describe('resolveBlitzConfig', () => {
        it('preserves servers string', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.servers).toBe('nats://localhost:4222');
        });

        it('preserves servers array', () => {
            const cfg = resolveBlitzConfig({ servers: ['nats://a:4222', 'nats://b:4222'] });
            expect(cfg.servers).toEqual(['nats://a:4222', 'nats://b:4222']);
        });

        it('applies default kvBucketPrefix', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.kvBucketPrefix).toBe('helios-blitz');
        });

        it('preserves custom kvBucketPrefix', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222', kvBucketPrefix: 'my-prefix' });
            expect(cfg.kvBucketPrefix).toBe('my-prefix');
        });

        it('applies default streamRetention', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.streamRetention).toBe('workqueue');
        });

        it('preserves custom streamRetention', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222', streamRetention: 'limits' });
            expect(cfg.streamRetention).toBe('limits');
        });

        it('applies default streamMaxAgeMs', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.streamMaxAgeMs).toBe(0);
        });

        it('applies default connectTimeoutMs', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.connectTimeoutMs).toBe(5000);
        });

        it('applies default reconnectWaitMs', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.reconnectWaitMs).toBe(2000);
        });

        it('applies default maxReconnectAttempts', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.maxReconnectAttempts).toBe(-1);
        });

        it('produces all required fields', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            const keys: (keyof typeof cfg)[] = [
                'servers', 'kvBucketPrefix', 'streamRetention',
                'streamMaxAgeMs', 'connectTimeoutMs', 'reconnectWaitMs', 'maxReconnectAttempts',
            ];
            for (const key of keys) {
                expect(cfg[key]).toBeDefined();
            }
        });
    });

    describe('resolveBlitzConfig — embedded/cluster extensions', () => {
        it('no args defaults to embedded in-memory', () => {
            const cfg = resolveBlitzConfig({});
            expect(cfg.embedded).toBeDefined();
            expect(cfg.servers).toBeUndefined();
            expect(cfg.cluster).toBeUndefined();
        });

        it('servers and embedded throws', () => {
            expect(() => resolveBlitzConfig({
                servers: 'nats://localhost:4222',
                embedded: {},
            })).toThrow(/exactly one of/i);
        });

        it('servers and cluster throws', () => {
            expect(() => resolveBlitzConfig({
                servers: 'nats://localhost:4222',
                cluster: { nodes: 3 },
            })).toThrow(/exactly one of/i);
        });

        it('embedded and cluster throws', () => {
            expect(() => resolveBlitzConfig({
                embedded: {},
                cluster: { nodes: 3 },
            })).toThrow(/exactly one of/i);
        });

        it('servers only resolves correctly', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://myhost:5222' });
            expect(cfg.servers).toBe('nats://myhost:5222');
            expect(cfg.embedded).toBeUndefined();
            expect(cfg.cluster).toBeUndefined();
        });

        it('embedded only applies default port', () => {
            const cfg = resolveBlitzConfig({ embedded: {} });
            expect(cfg.embedded).toBeDefined();
            expect(cfg.embedded!.port).toBe(4222);
        });

        it('embedded custom port preserved', () => {
            const cfg = resolveBlitzConfig({ embedded: { port: 14222 } });
            expect(cfg.embedded!.port).toBe(14222);
        });

        it('embedded custom dataDir preserved', () => {
            const cfg = resolveBlitzConfig({ embedded: { dataDir: '/tmp/blitz-data' } });
            expect(cfg.embedded!.dataDir).toBe('/tmp/blitz-data');
        });

        it('embedded startTimeoutMs defaults to 10000', () => {
            const cfg = resolveBlitzConfig({ embedded: {} });
            expect(cfg.embedded!.startTimeoutMs).toBe(10_000);
        });

        it('cluster nodes must be odd — 2 nodes throws', () => {
            expect(() => resolveBlitzConfig({
                cluster: { nodes: 2 },
            })).toThrow(/odd/i);
        });

        it('cluster nodes 3 succeeds', () => {
            const cfg = resolveBlitzConfig({ cluster: { nodes: 3 } });
            expect(cfg.cluster).toBeDefined();
            expect(cfg.cluster!.nodes).toBe(3);
        });

        it('cluster dataDir applied to all nodes', () => {
            const cfg = resolveBlitzConfig({ cluster: { nodes: 3, dataDir: '/data/blitz' } });
            expect(cfg.cluster!.dataDir).toBe('/data/blitz');
        });

        it('cluster port overlap throws (N7)', () => {
            expect(() => resolveBlitzConfig({
                cluster: { nodes: 3, basePort: 6222, baseClusterPort: 6222 },
            })).toThrow(/overlap/i);
        });

        it('cluster port no overlap succeeds (N7)', () => {
            const cfg = resolveBlitzConfig({
                cluster: { nodes: 3, basePort: 4222, baseClusterPort: 6222 },
            });
            expect(cfg.cluster).toBeDefined();
        });

        it('cluster defaults basePort=4222 and baseClusterPort=6222', () => {
            const cfg = resolveBlitzConfig({ cluster: { nodes: 3 } });
            expect(cfg.cluster!.basePort).toBe(4222);
            expect(cfg.cluster!.baseClusterPort).toBe(6222);
        });
    });
});
