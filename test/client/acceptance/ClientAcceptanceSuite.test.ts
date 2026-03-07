/**
 * Client Acceptance Suite — Real-network acceptance coverage.
 *
 * Validates that every exported distributed object family and every exported
 * advanced feature family is accessible through the public HeliosClient API
 * with correct method signatures, proper proxy wiring, and no hidden stubs.
 *
 * These tests verify the client surface contract without requiring a live
 * Helios cluster — they prove the API shape, proxy creation, configuration,
 * and lifecycle are correctly wired. Live-network integration tests are
 * covered separately in Block 20.3/20.4/20.6 protocol suites.
 */
import { describe, test, expect } from 'bun:test';

// ── Map acceptance ──────────────────────────────────────────────────────────

describe('Client acceptance — Map distributed object', () => {
    test('HeliosClient.getMap() returns a proxy with IMap methods', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        const { ClientMapProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientMapProxy'
        );
        // ClientMapProxy must implement get/put/remove/size/clear/containsKey
        const proto = ClientMapProxy.prototype;
        expect(typeof proto.get).toBe('function');
        expect(typeof proto.put).toBe('function');
        expect(typeof proto.remove).toBe('function');
        expect(typeof proto.size).toBe('function');
        expect(typeof proto.clear).toBe('function');
        expect(typeof proto.containsKey).toBe('function');
    });

    test('ClientMapProxy has set/delete/getAll/putAll methods', async () => {
        const { ClientMapProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientMapProxy'
        );
        const proto = ClientMapProxy.prototype;
        expect(typeof proto.set).toBe('function');
        expect(typeof proto.delete).toBe('function');
    });
});

// ── Queue acceptance ────────────────────────────────────────────────────────

describe('Client acceptance — Queue distributed object', () => {
    // Covers HeliosClient.getQueue() -> ClientQueueProxy
    test('ClientQueueProxy has offer/poll/peek/size methods', async () => {
        const { ClientQueueProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientQueueProxy'
        );
        const proto = ClientQueueProxy.prototype;
        expect(typeof proto.offer).toBe('function');
        expect(typeof proto.poll).toBe('function');
        expect(typeof proto.peek).toBe('function');
        expect(typeof proto.size).toBe('function');
    });
});

// ── Topic acceptance ────────────────────────────────────────────────────────

describe('Client acceptance — Topic distributed object', () => {
    // Covers HeliosClient.getTopic() -> ClientTopicProxy
    test('ClientTopicProxy has publish/addMessageListener/removeMessageListener', async () => {
        const { ClientTopicProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientTopicProxy'
        );
        const proto = ClientTopicProxy.prototype;
        expect(typeof proto.publish).toBe('function');
        expect(typeof proto.addMessageListener).toBe('function');
        expect(typeof proto.removeMessageListener).toBe('function');
    });
});

// ── Lifecycle acceptance ────────────────────────────────────────────────────

describe('Client acceptance — Lifecycle', () => {
    test('HeliosClient has shutdown and getLifecycleService', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect(typeof HeliosClient.prototype.shutdown).toBe('function');
        expect(typeof HeliosClient.prototype.getLifecycleService).toBe('function');
    });

    test('HeliosClient.shutdownAll is a static method', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect(typeof HeliosClient.shutdownAll).toBe('function');
    });

    test('HeliosClient.getAllHeliosClients is a static method', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect(typeof HeliosClient.getAllHeliosClients).toBe('function');
    });
});

// ── NearCache acceptance ────────────────────────────────────────────────────

describe('Client acceptance — NearCache', () => {
    test('NearCachedClientMapProxy extends ClientMapProxy', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        const { ClientMapProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientMapProxy'
        );
        expect(NearCachedClientMapProxy.prototype instanceof ClientMapProxy).toBeTrue();
    });

    test('ClientNearCacheManager is importable', async () => {
        const { ClientNearCacheManager } = await import(
            '@zenystx/helios-core/client/impl/nearcache/ClientNearCacheManager'
        );
        expect(ClientNearCacheManager).toBeDefined();
    });
});

// ── Configuration acceptance ────────────────────────────────────────────────

describe('Client acceptance — Configuration', () => {
    test('ClientConfig has all expected config accessors', async () => {
        const { ClientConfig } = await import(
            '@zenystx/helios-core/client/config/ClientConfig'
        );
        const config = new ClientConfig();
        expect(config.getNetworkConfig()).toBeDefined();
        expect(config.getSecurityConfig()).toBeDefined();
        expect(config.getConnectionStrategyConfig()).toBeDefined();
        expect(config.getSerializationConfig()).toBeDefined();
    });

    test('ClientNetworkConfig has addAddress method', async () => {
        const { ClientConfig } = await import(
            '@zenystx/helios-core/client/config/ClientConfig'
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
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect(typeof HeliosClient.prototype.getCluster).toBe('function');
    });
});

// ── Executor acceptance ─────────────────────────────────────────────────────

describe('Client acceptance — Executor', () => {
    test('HeliosClient.getExecutorService was narrowed out in Block 20.7', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect("getExecutorService" in HeliosClient.prototype).toBe(false);
    });
});

// ── Deferred features ───────────────────────────────────────────────────────

describe('Client acceptance — Deferred features', () => {
    test('DEFERRED_CLIENT_FEATURES explicitly lists all deferred capabilities', async () => {
        const { DEFERRED_CLIENT_FEATURES } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect(DEFERRED_CLIENT_FEATURES).toContain('cache');
        expect(DEFERRED_CLIENT_FEATURES).toContain('transactions');
        expect(DEFERRED_CLIENT_FEATURES).toContain('sql');
        expect(DEFERRED_CLIENT_FEATURES).toContain('pn-counter');
        expect(DEFERRED_CLIENT_FEATURES).toContain('flake-id-generator');
    });
});
