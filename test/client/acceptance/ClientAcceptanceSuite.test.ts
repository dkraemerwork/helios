/**
 * Client Acceptance Suite — public client surface acceptance coverage.
 *
 * Validates only the retained, package-public client entrypoints: HeliosClient,
 * ClientConfig, and root-barrel config exports used by that client surface.
 *
 * These tests verify the client surface contract without requiring a live
 * Helios cluster — they prove API shape, public methods, retained config,
 * and lifecycle wiring only. Internal proxy / near-cache implementation
 * classes are intentionally excluded from this package-public proof.
 * Real-network behavior is covered separately in the client E2E suites that
 * connect over the binary client protocol.
 */
import { describe, test, expect } from 'bun:test';

// ── Map acceptance ──────────────────────────────────────────────────────────

describe('Client acceptance — Map distributed object', () => {
    test('HeliosClient.getMap() returns a public map object with retained methods', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        const client = new HeliosClient();
        const map = client.getMap('acceptance-map') as unknown as Record<string, unknown>;
        expect(typeof map.get).toBe('function');
        expect(typeof map.put).toBe('function');
        expect(typeof map.remove).toBe('function');
        expect(typeof map.size).toBe('function');
        expect(typeof map.clear).toBe('function');
        expect(typeof map.containsKey).toBe('function');
        client.shutdown();
    });

    test('HeliosClient.getMap() exposes retained convenience methods', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        const client = new HeliosClient();
        const map = client.getMap('acceptance-map') as unknown as Record<string, unknown>;
        expect(typeof map.set).toBe('function');
        expect(typeof map.delete).toBe('function');
        client.shutdown();
    });
});

// ── Queue acceptance ────────────────────────────────────────────────────────

describe('Client acceptance — Queue distributed object', () => {
    test('HeliosClient.getQueue() returns a public queue object with retained methods', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        const client = new HeliosClient();
        const queue = client.getQueue('acceptance-queue') as unknown as Record<string, unknown>;
        expect(typeof queue.offer).toBe('function');
        expect(typeof queue.poll).toBe('function');
        expect(typeof queue.peek).toBe('function');
        expect(typeof queue.size).toBe('function');
        client.shutdown();
    });
});

// ── Topic acceptance ────────────────────────────────────────────────────────

describe('Client acceptance — Topic distributed object', () => {
    test('HeliosClient.getTopic() returns a public topic object with retained methods', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        const client = new HeliosClient();
        const topic = client.getTopic('acceptance-topic') as unknown as Record<string, unknown>;
        expect(typeof topic.publish).toBe('function');
        expect(typeof topic.addMessageListener).toBe('function');
        expect(typeof topic.removeMessageListener).toBe('function');
        client.shutdown();
    });
});

// ── Lifecycle acceptance ────────────────────────────────────────────────────

describe('Client acceptance — Lifecycle', () => {
    test('HeliosClient has shutdown and getLifecycleService', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect(typeof HeliosClient.prototype.shutdown).toBe('function');
        expect(typeof HeliosClient.prototype.getLifecycleService).toBe('function');
    });

    test('HeliosClient.shutdownAll is a static method', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect(typeof HeliosClient.shutdownAll).toBe('function');
    });

    test('HeliosClient.getAllHeliosClients is a static method', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect(typeof HeliosClient.getAllHeliosClients).toBe('function');
    });
});

// ── NearCache acceptance ────────────────────────────────────────────────────

describe('Client acceptance — NearCache', () => {
    test('public near-cache coverage is limited to retained configuration surface', async () => {
        const { NearCacheConfig } = await import(
            '@zenystx/helios-core'
        );
        const { ClientConfig } = await import(
            '@zenystx/helios-core/client/config'
        );
        const config = new ClientConfig();
        const nearCacheConfig = new NearCacheConfig('acceptance-*');
        config.addNearCacheConfig(nearCacheConfig);
        expect(config.getNearCacheConfig('acceptance-near-cache')).toBe(nearCacheConfig);
        expect(config.getNearCacheConfigMap().get('acceptance-*')).toBe(nearCacheConfig);
    });
});

// ── Configuration acceptance ────────────────────────────────────────────────

describe('Client acceptance — Configuration', () => {
    test('ClientConfig has all expected config accessors', async () => {
        const { ClientConfig } = await import(
            '@zenystx/helios-core/client/config'
        );
        const config = new ClientConfig();
        expect(config.getNetworkConfig()).toBeDefined();
        expect(config.getSecurityConfig()).toBeDefined();
        expect(config.getConnectionStrategyConfig()).toBeDefined();
        expect(config.getSerializationConfig()).toBeDefined();
    });

    test('ClientNetworkConfig has addAddress method', async () => {
        const { ClientConfig } = await import(
            '@zenystx/helios-core/client/config'
        );
        const config = new ClientConfig();
        const network = config.getNetworkConfig();
        expect(typeof network.addAddress).toBe('function');
    });
});

// ── Cluster acceptance ──────────────────────────────────────────────────────

describe('Client acceptance — Cluster', () => {
    test('HeliosClient.getCluster returns Cluster interface', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect(typeof HeliosClient.prototype.getCluster).toBe('function');
    });
});

// ── Executor acceptance ─────────────────────────────────────────────────────

describe('Client acceptance — Executor', () => {
    test('HeliosClient.getExecutorService was narrowed out in Block 20.7', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect("getExecutorService" in HeliosClient.prototype).toBe(false);
    });
});

// ── Deferred features ───────────────────────────────────────────────────────

describe('Client acceptance — Deferred features', () => {
    test('DEFERRED_CLIENT_FEATURES explicitly lists all deferred capabilities', async () => {
        const { DEFERRED_CLIENT_FEATURES } = await import(
            '@zenystx/helios-core/client'
        );
        expect(DEFERRED_CLIENT_FEATURES).toContain('cache');
        expect(DEFERRED_CLIENT_FEATURES).toContain('transactions');
        expect(DEFERRED_CLIENT_FEATURES).toContain('sql');
        expect(DEFERRED_CLIENT_FEATURES).toContain('pn-counter');
        expect(DEFERRED_CLIENT_FEATURES).toContain('flake-id-generator');
    });
});
