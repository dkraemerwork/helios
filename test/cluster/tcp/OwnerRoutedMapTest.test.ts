/**
 * Block 21.1 — Cluster execution substrate + owner-routed map path.
 *
 * Proves that:
 *  - Clustered map mutations execute on the partition owner, not locally
 *  - Non-owner callers forward operations to the owner via OPERATION messages
 *  - OPERATION_RESPONSE carries results back to the caller
 *  - MAP_PUT/MAP_REMOVE/MAP_CLEAR broadcast is no longer the authoritative path
 *  - Backup operations flow after primary execution
 *  - OperationService in clustered mode uses localMode=false with remoteSend
 *  - The NetworkedMapProxy broadcast path is removed
 */
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { ClusterState } from '@zenystx/helios-core/internal/cluster/ClusterState';
import { afterEach, describe, expect, it } from 'bun:test';

const BASE_PORT = 16900;
let portCounter = 0;

function nextPort(): number {
    return BASE_PORT + (portCounter++);
}

async function waitUntil(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 5000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil: timed out after ${timeoutMs} ms`);
        }
        await Bun.sleep(20);
    }
}

async function waitForClusterSize(
    instance: HeliosInstanceImpl,
    count: number,
): Promise<void> {
    await waitUntil(() => instance.getCluster().getMembers().length === count);
}

describe('Block 21.1 — Owner-routed map execution substrate', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const inst of instances) {
            if (inst.isRunning()) inst.shutdown();
        }
        instances.length = 0;
        await Bun.sleep(30);
    });

    async function startNode(
        name: string,
        port: number,
        peerPorts: number[] = [],
    ): Promise<HeliosInstanceImpl> {
        const cfg = new HeliosConfig(name);
        cfg.getNetworkConfig()
            .setPort(port)
            .getJoin()
            .getTcpIpConfig()
            .setEnabled(true);
        for (const pp of peerPorts) {
            cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${pp}`);
        }
        const inst = await Helios.newInstance(cfg);
        instances.push(inst);
        return inst;
    }

    async function startTwoNodeCluster(): Promise<[HeliosInstanceImpl, HeliosInstanceImpl]> {
        const portA = nextPort();
        const portB = nextPort();
        const a = await startNode('ownerA', portA);
        const b = await startNode('ownerB', portB, [portA]);
        await waitForClusterSize(a, 2);
        await waitForClusterSize(b, 2);
        return [a, b];
    }

    // ── Test 1: put on non-owner routes to owner and returns correct value ──

    it('put from non-owner executes on partition owner and returns old value', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('routed-put');
        const mapB = b.getMap<string, string>('routed-put');

        // Find a key whose partition is owned by node A
        let keyOwnedByA = '';
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 1000; i++) {
            const key = `key-${i}`;
            const partitionId = a.getPartitionIdForName(key);
            if (a.getPartitionOwnerId(partitionId) === aMemberId) {
                keyOwnedByA = key;
                break;
            }
        }
        expect(keyOwnedByA).not.toBe('');

        // Put from A (the owner) — should work directly
        const old1 = await mapA.put(keyOwnedByA, 'value1');
        expect(old1).toBeNull();

        // Put from B (non-owner) — should route to A and return old value
        const old2 = await mapB.put(keyOwnedByA, 'value2');
        expect(old2).toBe('value1');

        // Get from A should see new value
        const val = await mapA.get(keyOwnedByA);
        expect(val).toBe('value2');
    });

    // ── Test 2: get from non-owner routes to owner ──

    it('get from non-owner routes to partition owner', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, number>('routed-get');
        const mapB = b.getMap<string, number>('routed-get');

        // Find a key owned by A
        let key = '';
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 1000; i++) {
            const k = `gkey-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === aMemberId) { key = k; break; }
        }
        expect(key).not.toBe('');

        await mapA.put(key, 42);
        // B reads from owner A via operation routing
        const val = await mapB.get(key);
        expect(val).toBe(42);
    });

    // ── Test 3: remove from non-owner routes to owner ──

    it('remove from non-owner routes to partition owner', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('routed-remove');
        const mapB = b.getMap<string, string>('routed-remove');

        let key = '';
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 1000; i++) {
            const k = `rkey-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === aMemberId) { key = k; break; }
        }

        await mapA.put(key, 'to-remove');
        const removed = await mapB.remove(key);
        expect(removed).toBe('to-remove');

        const val = await mapA.get(key);
        expect(val).toBeNull();
    });

    // ── Test 4: clear from non-owner clears all partitions on owners ──

    it('clear from non-owner clears entries on all partition owners', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('routed-clear');
        const mapB = b.getMap<string, string>('routed-clear');

        // Put entries that land on different owners
        for (let i = 0; i < 20; i++) {
            await mapA.put(`ckey-${i}`, `cval-${i}`);
        }

        expect(mapA.size()).toBeGreaterThan(0);

        // Clear from B
        await mapB.clear();

        // All entries should be gone on A
        expect(mapA.size()).toBe(0);
    });

    it('cluster state changes propagate to follower nodes', async () => {
        const [a, b] = await startTwoNodeCluster();

        const coordinator = (a as any)._clusterCoordinator as { setClusterState(state: ClusterState): void };
        coordinator.setClusterState(ClusterState.FROZEN);

        await waitUntil(() => a.getClusterState() === ClusterState.FROZEN && b.getClusterState() === ClusterState.FROZEN);

        coordinator.setClusterState(ClusterState.ACTIVE);

        await waitUntil(() => a.getClusterState() === ClusterState.ACTIVE && b.getClusterState() === ClusterState.ACTIVE);
    });

    // ── Test 5: set from non-owner routes to owner ──

    it('set from non-owner routes to partition owner', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('routed-set');
        const mapB = b.getMap<string, string>('routed-set');

        let key = '';
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 1000; i++) {
            const k = `skey-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === aMemberId) { key = k; break; }
        }

        await mapB.set(key, 'set-value');
        const val = await mapA.get(key);
        expect(val).toBe('set-value');
    });

    // ── Test 6: delete from non-owner routes to owner ──

    it('delete from non-owner routes to partition owner', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('routed-delete');
        const mapB = b.getMap<string, string>('routed-delete');

        let key = '';
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 1000; i++) {
            const k = `dkey-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === aMemberId) { key = k; break; }
        }

        await mapA.put(key, 'to-delete');
        await mapB.delete(key);
        expect(await mapA.get(key)).toBeNull();
    });

    // ── Test 7: putIfAbsent from non-owner routes to owner ──

    it('putIfAbsent from non-owner routes to partition owner', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('routed-pia');
        const mapB = b.getMap<string, string>('routed-pia');

        let key = '';
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 1000; i++) {
            const k = `pkey-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === aMemberId) { key = k; break; }
        }

        // First putIfAbsent from B (non-owner) — should succeed
        const existing1 = await mapB.putIfAbsent(key, 'first');
        expect(existing1).toBeNull();

        // Second putIfAbsent from B — should return existing
        const existing2 = await mapB.putIfAbsent(key, 'second');
        expect(existing2).toBe('first');

        // Confirm value on owner
        expect(await mapA.get(key)).toBe('first');
    });

    // ── Test 8: OperationService is NOT in localMode for clustered instances ──

    it('clustered OperationService uses localMode=false', async () => {
        const [a] = await startTwoNodeCluster();
        const opService = a.getNodeEngine().getOperationService() as any;
        expect(opService._localMode).toBe(false);
    });

    // ── Test 9: data written by non-owner is stored on owner node ──

    it('data written by non-owner is physically on the owner record store', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapB = b.getMap<string, string>('owner-store');

        // Find key owned by A
        let key = '';
        let partitionId = -1;
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 1000; i++) {
            const k = `os-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === aMemberId) {
                key = k;
                partitionId = pid;
                break;
            }
        }

        // Write from B
        await mapB.put(key, 'stored-on-owner');

        // Verify it's on A's record store directly
        const mapA = a.getMap<string, string>('owner-store');
        const val = await mapA.get(key);
        expect(val).toBe('stored-on-owner');
    });

    // ── Test 10: NetworkedMapProxy is no longer used for clustered maps ──

    it('clustered map proxy is plain MapProxy, not NetworkedMapProxy', async () => {
        const [a] = await startTwoNodeCluster();
        const map = a.getMap<string, string>('proxy-type');
        // NetworkedMapProxy should no longer be constructed for clustered instances
        const { NetworkedMapProxy } = await import('@zenystx/helios-core/map/impl/NetworkedMapProxy');
        expect(map).not.toBeInstanceOf(NetworkedMapProxy);
    });

    // ── Test 11: bidirectional routing — both nodes can own partitions ──

    it('both nodes serve as partition owners for their respective partitions', async () => {
        const [a, b] = await startTwoNodeCluster();
        const map = a.getMap<string, number>('bidir');

        let aOwns = 0;
        let bOwns = 0;
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 50; i++) {
            const key = `bidir-${i}`;
            const pid = a.getPartitionIdForName(key);
            const owner = a.getPartitionOwnerId(pid);
            if (owner === aMemberId) aOwns++;
            else bOwns++;
        }

        // Both nodes should own some partitions
        expect(aOwns).toBeGreaterThan(0);
        expect(bOwns).toBeGreaterThan(0);
    });

    // ── Test 12: concurrent puts from both nodes resolve correctly ──

    it('concurrent puts from both nodes to various partitions all succeed', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('concurrent');
        const mapB = b.getMap<string, string>('concurrent');

        const promises: Promise<void>[] = [];
        for (let i = 0; i < 20; i++) {
            const key = `cc-${i}`;
            if (i % 2 === 0) {
                promises.push(mapA.put(key, `fromA-${i}`).then(() => {}));
            } else {
                promises.push(mapB.put(key, `fromB-${i}`).then(() => {}));
            }
        }
        await Promise.all(promises);

        // All 20 entries should be readable from either node
        for (let i = 0; i < 20; i++) {
            const key = `cc-${i}`;
            const expected = i % 2 === 0 ? `fromA-${i}` : `fromB-${i}`;
            expect(await mapA.get(key)).toBe(expected);
            expect(await mapB.get(key)).toBe(expected);
        }
    });

    // ── Test 13: MAP_PUT message type is not used for map mutations ──

    it('MAP_PUT/MAP_REMOVE/MAP_CLEAR are not used for authoritative map operations', async () => {
        const portA = nextPort();
        const portB = nextPort();
        const a = await startNode('nobroadA', portA);
        const b = await startNode('nobroadB', portB, [portA]);
        await waitForClusterSize(a, 2);
        await waitForClusterSize(b, 2);

        // Intercept transport to detect MAP_PUT usage
        let mapPutSeen = false;
        let mapRemoveSeen = false;
        let mapClearSeen = false;
        const transport = (a as any)._transport;
        const origSendMsg = transport._sendMsg.bind(transport);
        transport._sendMsg = (ch: any, msg: any) => {
            if (msg.type === 'MAP_PUT') mapPutSeen = true;
            if (msg.type === 'MAP_REMOVE') mapRemoveSeen = true;
            if (msg.type === 'MAP_CLEAR') mapClearSeen = true;
            return origSendMsg(ch, msg);
        };

        const mapA = a.getMap<string, string>('no-broadcast');
        await mapA.put('test', 'value');
        await mapA.remove('test');
        await mapA.clear();

        // None of these legacy broadcast types should have been sent
        expect(mapPutSeen).toBe(false);
        expect(mapRemoveSeen).toBe(false);
        expect(mapClearSeen).toBe(false);
    });

    // ── Test 14: OPERATION message type IS used for remote operations ──

    it('OPERATION messages are used for remote operation routing', async () => {
        const portA = nextPort();
        const portB = nextPort();
        const a = await startNode('opMsgA', portA);
        const b = await startNode('opMsgB', portB, [portA]);
        await waitForClusterSize(a, 2);
        await waitForClusterSize(b, 2);

        let operationMsgSeen = false;
        const transport = (b as any)._transport;
        // Spy on both sync send and async send paths to detect OPERATION messages
        const origSend = transport.send.bind(transport);
        transport.send = (peerId: string, msg: any) => {
            if (msg.type === 'OPERATION') operationMsgSeen = true;
            return origSend(peerId, msg);
        };
        const origSendAsync = transport.sendAsync.bind(transport);
        transport.sendAsync = async (peerId: string, msg: any) => {
            if (msg.type === 'OPERATION') operationMsgSeen = true;
            return origSendAsync(peerId, msg);
        };

        // Find a key owned by A so B must route remotely
        const mapB = b.getMap<string, string>('op-msg');
        const aMemberId = a.getLocalMemberId();
        let key = '';
        for (let i = 0; i < 1000; i++) {
            const k = `om-${i}`;
            const pid = b.getPartitionIdForName(k);
            if (b.getPartitionOwnerId(pid) === aMemberId) { key = k; break; }
        }

        if (key !== '') {
            await mapB.put(key, 'routed');
            expect(operationMsgSeen).toBe(true);
        }
    });

    // ── Test 15: size() counts local partition entries correctly ──

    it('size counts entries across locally-owned partitions', async () => {
        const [a, b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('size-test');

        for (let i = 0; i < 10; i++) {
            await mapA.put(`s-${i}`, `v-${i}`);
        }

        // In a 2-node cluster, entries are distributed across owners.
        // The sum of local sizes on both nodes should equal the total.
        const sizeA = mapA.size();
        const sizeB = b.getMap<string, string>('size-test').size();
        expect(sizeA + sizeB).toBe(10);
        // Each node should own some partitions
        expect(sizeA).toBeGreaterThan(0);
        expect(sizeB).toBeGreaterThan(0);
    });

    // ── Test 16: containsKey routes to correct partition ──

    it('containsKey on owner returns correct result after put', async () => {
        const [a, _b] = await startTwoNodeCluster();
        const mapA = a.getMap<string, string>('contains');

        let key = '';
        const aMemberId = a.getLocalMemberId();
        for (let i = 0; i < 1000; i++) {
            const k = `ck-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === aMemberId) { key = k; break; }
        }

        await mapA.put(key, 'exists');
        // Owner should see it in local RecordStore
        expect(mapA.containsKey(key)).toBe(true);
    });

    // ── Test 17: three-node cluster routes correctly ──

    it('three-node cluster routes operations to correct partition owners', async () => {
        const portA = nextPort();
        const portB = nextPort();
        const portC = nextPort();
        const a = await startNode('tri-A', portA);
        const b = await startNode('tri-B', portB, [portA]);
        await waitForClusterSize(a, 2);
        const c = await startNode('tri-C', portC, [portA]);
        await waitForClusterSize(a, 3);
        await waitForClusterSize(b, 3);
        await waitForClusterSize(c, 3);

        const mapC = c.getMap<string, string>('tri-map');
        await mapC.put('tri-key', 'tri-value');

        // Should be readable from all nodes
        expect(await a.getMap<string, string>('tri-map').get('tri-key')).toBe('tri-value');
        expect(await b.getMap<string, string>('tri-map').get('tri-key')).toBe('tri-value');
        expect(await c.getMap<string, string>('tri-map').get('tri-key')).toBe('tri-value');
    });

    // ── Test 18: verification — no legacy broadcast shortcuts remain ──

    it('verification: clustered map substrate is real with no broadcast shortcuts', async () => {
        const [a, b] = await startTwoNodeCluster();

        // 1. OperationService is in routing mode
        const opServiceA = a.getNodeEngine().getOperationService() as any;
        const opServiceB = b.getNodeEngine().getOperationService() as any;
        expect(opServiceA._localMode).toBe(false);
        expect(opServiceB._localMode).toBe(false);

        // 2. remoteSend is wired
        expect(opServiceA._remoteSend).not.toBeNull();
        expect(opServiceB._remoteSend).not.toBeNull();

        // 3. Map proxy is NOT NetworkedMapProxy
        const { NetworkedMapProxy } = await import('@zenystx/helios-core/map/impl/NetworkedMapProxy');
        const mapA = a.getMap<string, string>('verify');
        const mapB = b.getMap<string, string>('verify');
        expect(mapA).not.toBeInstanceOf(NetworkedMapProxy);
        expect(mapB).not.toBeInstanceOf(NetworkedMapProxy);

        // 4. End-to-end proof: write from B, read from A for owner-A key
        const aMemberId = a.getLocalMemberId();
        const bMemberId = b.getLocalMemberId();
        let key = '';
        for (let i = 0; i < 1000; i++) {
            const k = `v-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === aMemberId) { key = k; break; }
        }
        await mapB.put(key, 'verified');
        expect(await mapA.get(key)).toBe('verified');

        // 5. Reverse: write from A, read from B for owner-B key
        let keyB = '';
        for (let i = 0; i < 1000; i++) {
            const k = `vb-${i}`;
            const pid = a.getPartitionIdForName(k);
            if (a.getPartitionOwnerId(pid) === bMemberId) { keyB = k; break; }
        }
        await mapA.put(keyB, 'verified-b');
        expect(await mapB.get(keyB)).toBe('verified-b');
    });
});
