/**
 * Block 7.5 — Multi-node TCP integration test.
 *
 * Proves two real Helios instances can communicate over TCP using
 * Bun.listen / Bun.connect via the TcpClusterTransport:
 *  - Instance A starts, listens on a port
 *  - Instance B connects to Instance A
 *  - Instance B puts a map entry that Instance A can read
 *  - Instance A puts a map entry that Instance B can read
 *  - Near-cache INVALIDATE messages propagate between nodes
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { Helios } from '@helios/Helios';
import { HeliosConfig } from '@helios/config/HeliosConfig';
import type { HeliosInstanceImpl } from '@helios/instance/impl/HeliosInstanceImpl';

// Ports in the 15780+ range — unlikely to conflict with other tests.
const BASE_PORT = 15780;

/** Wait (poll) until `predicate()` returns true or timeout is reached. */
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil: timed out after ${timeoutMs} ms`);
        }
        await Bun.sleep(20);
    }
}

/** Wait for nodeA to see at least `count` connected peers. */
async function waitForPeers(instance: HeliosInstanceImpl, count: number): Promise<void> {
    await waitUntil(() => instance.getTcpPeerCount() >= count);
}

describe('Multi-node TCP integration', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const inst of instances) {
            if (inst.isRunning()) inst.shutdown();
        }
        instances.length = 0;
        // Brief pause so ports are fully released before next test
        await Bun.sleep(30);
    });

    // ── Helpers ───────────────────────────────────────────────────────────

    async function startNodeA(portOffset = 0): Promise<HeliosInstanceImpl> {
        const cfg = new HeliosConfig(`nodeA-${portOffset}`);
        cfg.getNetworkConfig()
            .setPort(BASE_PORT + portOffset)
            .getJoin()
            .getTcpIpConfig()
            .setEnabled(true);
        const inst = await Helios.newInstance(cfg);
        instances.push(inst);
        return inst;
    }

    async function startNodeB(portOffset: number, peerPort: number): Promise<HeliosInstanceImpl> {
        const cfg = new HeliosConfig(`nodeB-${portOffset}`);
        cfg.getNetworkConfig()
            .setPort(BASE_PORT + portOffset)
            .getJoin()
            .getTcpIpConfig()
            .setEnabled(true)
            .addMember(`localhost:${peerPort}`);
        const inst = await Helios.newInstance(cfg);
        instances.push(inst);
        return inst;
    }

    // ── Tests ─────────────────────────────────────────────────────────────

    it('nodeB_put_replicates_to_nodeA', async () => {
        const nodeA = await startNodeA(0);
        const nodeB = await startNodeB(1, BASE_PORT + 0);

        await waitForPeers(nodeA, 1);

        const mapB = nodeB.getMap<string, string>('shared');
        mapB.put('hello', 'world');

        // Allow replication to propagate
        await waitUntil(() => nodeA.getMap<string, string>('shared').get('hello') === 'world');

        expect(nodeA.getMap<string, string>('shared').get('hello')).toBe('world');
    });

    it('nodeA_put_replicates_to_nodeB', async () => {
        const nodeA = await startNodeA(2);
        const nodeB = await startNodeB(3, BASE_PORT + 2);

        await waitForPeers(nodeA, 1);

        const mapA = nodeA.getMap<string, string>('shared');
        mapA.put('foo', 'bar');

        await waitUntil(() => nodeB.getMap<string, string>('shared').get('foo') === 'bar');

        expect(nodeB.getMap<string, string>('shared').get('foo')).toBe('bar');
    });

    it('remove_propagates_to_peer', async () => {
        const nodeA = await startNodeA(4);
        const nodeB = await startNodeB(5, BASE_PORT + 4);

        await waitForPeers(nodeA, 1);

        // Put on A, verify B sees it
        nodeA.getMap<string, string>('shared').put('k', 'v');
        await waitUntil(() => nodeB.getMap<string, string>('shared').get('k') === 'v');

        // Remove on A, verify B loses it
        nodeA.getMap<string, string>('shared').remove('k');
        await waitUntil(() => nodeB.getMap<string, string>('shared').get('k') === null);

        expect(nodeB.getMap<string, string>('shared').get('k')).toBeNull();
    });

    it('entry_listener_fires_for_remote_put', async () => {
        const nodeA = await startNodeA(6);
        const nodeB = await startNodeB(7, BASE_PORT + 6);

        await waitForPeers(nodeA, 1);

        const received: string[] = [];
        nodeA.getMap<string, string>('listen-map').addEntryListener({
            entryAdded: (event) => received.push(`add:${event.getKey()}=${event.getValue()}`),
            entryUpdated: (event) => received.push(`upd:${event.getKey()}=${event.getValue()}`),
        }, true);

        // B puts two entries
        const mapB = nodeB.getMap<string, string>('listen-map');
        mapB.put('x', '1');
        mapB.put('y', '2');

        await waitUntil(() => received.length >= 2);

        expect(received).toContain('add:x=1');
        expect(received).toContain('add:y=2');
    });

    it('invalidate_message_propagates_on_update', async () => {
        const nodeA = await startNodeA(8);
        const nodeB = await startNodeB(9, BASE_PORT + 8);

        await waitForPeers(nodeA, 1);

        // Seed a value via A
        nodeA.getMap<string, string>('inv-map').put('key', 'v1');
        await waitUntil(() => nodeB.getMap<string, string>('inv-map').get('key') === 'v1');

        // Collect INVALIDATE notifications on B's transport
        const invalidated: Array<{ mapName: string; key: unknown }> = [];
        nodeB.onRemoteInvalidate((mapName, key) => {
            invalidated.push({ mapName, key });
        });

        // A updates the value — should trigger INVALIDATE on B
        nodeA.getMap<string, string>('inv-map').put('key', 'v2');

        await waitUntil(() => invalidated.some(e => e.mapName === 'inv-map'));

        expect(invalidated.some(e => e.mapName === 'inv-map')).toBe(true);
        // After invalidation + replication, B should see the fresh value
        await waitUntil(() => nodeB.getMap<string, string>('inv-map').get('key') === 'v2');
        expect(nodeB.getMap<string, string>('inv-map').get('key')).toBe('v2');
    });

    it('bidirectional_put_and_update', async () => {
        const nodeA = await startNodeA(10);
        const nodeB = await startNodeB(11, BASE_PORT + 10);

        await waitForPeers(nodeA, 1);

        const mapA = nodeA.getMap<string, string>('bidir');
        const mapB = nodeB.getMap<string, string>('bidir');

        // A puts
        mapA.put('a', '1');
        await waitUntil(() => mapB.get('a') === '1');
        expect(mapB.get('a')).toBe('1');

        // B puts
        mapB.put('b', '2');
        await waitUntil(() => mapA.get('b') === '2');
        expect(mapA.get('b')).toBe('2');

        // A updates B's entry
        mapA.put('b', '3');
        await waitUntil(() => mapB.get('b') === '3');
        expect(mapB.get('b')).toBe('3');
    });
});
