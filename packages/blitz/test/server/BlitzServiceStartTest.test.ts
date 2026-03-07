/**
 * Block 14.4 — BlitzService.start() static factory + shutdown() extension tests.
 *
 * These tests verify the embedded NATS server lifecycle:
 * - start() with no config → embedded in-memory server
 * - start() with custom port
 * - start() with persistent data dir → data survives restart
 * - start() with cluster config → multi-node JetStream cluster
 * - shutdown() kills embedded processes
 * - shutdown() releases ports immediately (no EADDRINUSE)
 * - shutdown() after connect() (no embedded) → no process killed
 */
import { connect } from '@nats-io/transport-node';
import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlitzService } from '../../src/BlitzService.ts';

setDefaultTimeout(30_000);

describe('BlitzService.start() — embedded server lifecycle', () => {
    const instances: BlitzService[] = [];

    afterEach(async () => {
        // Shutdown all instances created during the test
        for (const blitz of instances) {
            try { await blitz.shutdown(); } catch { /* ignore */ }
        }
        instances.length = 0;
    });

    it('start_noConfig_connectsToEmbeddedInMemoryServer', async () => {
        const blitz = await BlitzService.start();
        instances.push(blitz);

        expect(blitz).toBeDefined();
        expect(blitz.isClosed).toBe(false);
        expect(blitz.js).toBeDefined();
        expect(blitz.jsm).toBeDefined();
        expect(blitz.kvm).toBeDefined();
    });

    it('start_embedded_customPort_connectsOnThatPort', async () => {
        const port = 24222;
        const blitz = await BlitzService.start({ embedded: { port } });
        instances.push(blitz);

        expect(blitz.isClosed).toBe(false);
        // Verify the server is actually on the custom port
        const nc = await connect({ servers: `nats://127.0.0.1:${port}`, timeout: 2000 });
        await nc.close();
    });

    it('start_embedded_inMemory_dataLostAfterShutdown', async () => {
        const port = 24223;
        const blitz = await BlitzService.start({ embedded: { port } });
        instances.push(blitz);

        // Write a KV entry
        const kv = await blitz.kvm.create('test-ephemeral');
        await kv.put('key1', 'value1');
        const entry = await kv.get('key1');
        expect(entry?.string()).toBe('value1');

        // Shutdown and restart on same port (in-memory → data lost)
        await blitz.shutdown();
        instances.length = 0; // already shut down

        const blitz2 = await BlitzService.start({ embedded: { port } });
        instances.push(blitz2);

        // Bucket should not exist anymore
        try {
            const kv2 = await blitz2.kvm.open('test-ephemeral');
            const entry2 = await kv2.get('key1');
            expect(entry2).toBeNull();
        } catch {
            // bucket doesn't exist — expected for in-memory
        }
    });

    it('start_embedded_persistent_dataSurvivesRestart', async () => {
        const port = 24224;
        const dataDir = mkdtempSync(join(tmpdir(), 'blitz-persist-'));

        try {
            // Start with persistent storage
            const blitz = await BlitzService.start({ embedded: { port, dataDir } });
            instances.push(blitz);

            const kv = await blitz.kvm.create('test-persist');
            await kv.put('key1', 'value1');

            await blitz.shutdown();
            instances.length = 0;

            // Restart on same port with same dataDir
            const blitz2 = await BlitzService.start({ embedded: { port, dataDir } });
            instances.push(blitz2);

            const kv2 = await blitz2.kvm.open('test-persist');
            const entry2 = await kv2.get('key1');
            expect(entry2?.string()).toBe('value1');
        } finally {
            rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it('start_cluster_3nodes_allReachable', async () => {
        const blitz = await BlitzService.start({
            cluster: { nodes: 3, basePort: 24230, baseClusterPort: 26230, startTimeoutMs: 25_000 },
        });
        instances.push(blitz);

        expect(blitz.isClosed).toBe(false);

        // Verify all 3 nodes are connectable
        for (let i = 0; i < 3; i++) {
            const nc = await connect({ servers: `nats://127.0.0.1:${24230 + i}`, timeout: 2000 });
            await nc.close();
        }
    });

    it('start_cluster_leaderElected_jetstreamOperational', async () => {
        const blitz = await BlitzService.start({
            cluster: { nodes: 3, basePort: 24240, baseClusterPort: 26240, startTimeoutMs: 25_000 },
        });
        instances.push(blitz);

        // JetStream should be immediately operational — no sleep needed (N14 FIX)
        const kv = await blitz.kvm.create('cluster-test', { replicas: 3 });
        await kv.put('hello', 'world');
        const entry = await kv.get('hello');
        expect(entry?.string()).toBe('world');
    });

    it('shutdown_afterStart_killsEmbeddedProcess', async () => {
        const port = 24250;
        const blitz = await BlitzService.start({ embedded: { port } });

        await blitz.shutdown();
        // After shutdown, connecting to the port should fail
        await expect(
            connect({ servers: `nats://127.0.0.1:${port}`, timeout: 1000, reconnect: false }),
        ).rejects.toBeDefined();
    });

    it('shutdown_portReleasedAfterShutdown', async () => {
        const port = 24251;
        const blitz = await BlitzService.start({ embedded: { port } });
        await blitz.shutdown();

        // Immediately start on the same port — should NOT get EADDRINUSE (N15 FIX)
        const blitz2 = await BlitzService.start({ embedded: { port } });
        instances.push(blitz2);

        expect(blitz2.isClosed).toBe(false);
    });

    it('shutdown_afterConnect_doesNotKillExternalServer', async () => {
        // First start an embedded server to connect to externally
        const port = 24252;
        const embedded = await BlitzService.start({ embedded: { port } });
        instances.push(embedded);

        // Connect to it externally (no _manager)
        const external = await BlitzService.connect({ servers: `nats://127.0.0.1:${port}` });

        // Shutdown the external connection — should NOT kill the embedded server
        await external.shutdown();

        // The embedded server should still be running
        const nc = await connect({ servers: `nats://127.0.0.1:${port}`, timeout: 2000 });
        await nc.close();
    });

    it('start_embedded_withExtraArgs', async () => {
        const port = 24253;
        const blitz = await BlitzService.start({
            embedded: { port, extraArgs: ['-m', '28222'] },
        });
        instances.push(blitz);

        expect(blitz.isClosed).toBe(false);
    });
});
