/**
 * Block 16.A0 — Multi-Node Test Infrastructure
 *
 * Tests for TestClusterNode and TestCluster — the harness used by all
 * subsequent Phase 16 integration tests.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { TestCluster } from '@helios/test-support/TestCluster';

describe('TestCluster', () => {
    let cluster: TestCluster;

    afterEach(async () => {
        if (cluster) {
            await cluster.shutdown();
        }
    });

    test('start 3 nodes, all see each other', async () => {
        cluster = new TestCluster({ clusterName: 'test-cluster', partitionCount: 271 });

        const node1 = await cluster.startNode();
        const node2 = await cluster.startNode();
        const node3 = await cluster.startNode();

        await cluster.waitForStable();

        // All three nodes should see 3 members
        expect(node1.clusterService.getMembers()).toHaveLength(3);
        expect(node2.clusterService.getMembers()).toHaveLength(3);
        expect(node3.clusterService.getMembers()).toHaveLength(3);

        // All nodes should be joined
        expect(node1.clusterService.isJoined()).toBe(true);
        expect(node2.clusterService.isJoined()).toBe(true);
        expect(node3.clusterService.isJoined()).toBe(true);

        // All nodes should agree on the master (first node)
        const masterAddr = node1.clusterService.getMasterAddress();
        expect(masterAddr).not.toBeNull();
        expect(node2.clusterService.getMasterAddress()!.equals(masterAddr!)).toBe(true);
        expect(node3.clusterService.getMasterAddress()!.equals(masterAddr!)).toBe(true);
    });

    test('killNode triggers member removal', async () => {
        cluster = new TestCluster({ clusterName: 'test-cluster', partitionCount: 271 });

        const node1 = await cluster.startNode();
        const node2 = await cluster.startNode();
        const node3 = await cluster.startNode();

        await cluster.waitForStable();
        expect(node1.clusterService.getMembers()).toHaveLength(3);

        // Kill node3
        await cluster.killNode(node3.nodeId);

        await cluster.waitForStable();

        // Surviving nodes should see only 2 members
        expect(node1.clusterService.getMembers()).toHaveLength(2);
        expect(node2.clusterService.getMembers()).toHaveLength(2);
    });

    test('waitForStable resolves after rebalancing', async () => {
        cluster = new TestCluster({ clusterName: 'test-cluster', partitionCount: 271 });

        await cluster.startNode();
        await cluster.startNode();

        // waitForStable should resolve without timeout
        await cluster.waitForStable();

        // After stable, all nodes agree on member list
        const nodes = cluster.getNodes();
        const memberCount = nodes[0].clusterService.getMembers().length;
        for (const node of nodes) {
            expect(node.clusterService.getMembers()).toHaveLength(memberCount);
        }
    });

    test('isolateNode causes suspicion', async () => {
        cluster = new TestCluster({
            clusterName: 'test-cluster',
            partitionCount: 271,
            heartbeatIntervalMillis: 50,
            maxNoHeartbeatMillis: 200,
        });

        const node1 = await cluster.startNode();
        const node2 = await cluster.startNode();

        await cluster.waitForStable();
        expect(node1.clusterService.getMembers()).toHaveLength(2);

        // Isolate node2 — blocks all TCP to/from it
        cluster.isolateNode(node2.nodeId);

        // Wait for heartbeat timeout (200ms) then manually pump heartbeat cycles
        await new Promise(r => setTimeout(r, 250));
        node1.heartbeatManager.runHeartbeatCycle();

        // node1 should suspect node2
        const node2Member = node1.clusterService.getMembers().find(
            m => m.getUuid() === node2.clusterService.getLocalMember().getUuid()
        );
        // After suspicion, node1 should suspect node2 if still in list
        expect(node2Member).toBeDefined();
        expect(node1.clusterService.isMemberSuspected(node2Member!)).toBe(true);
    });

    test('node restart (same address, new UUID) handled', async () => {
        cluster = new TestCluster({ clusterName: 'test-cluster', partitionCount: 271 });

        const node1 = await cluster.startNode();
        const node2 = await cluster.startNode();

        await cluster.waitForStable();
        const originalUuid = node2.clusterService.getLocalMember().getUuid();
        const node2Port = node2.boundPort!;

        // Kill node2 and restart on same port
        await cluster.killNode(node2.nodeId);
        await cluster.waitForStable();

        const node2b = await cluster.startNode({ port: node2Port });
        await cluster.waitForStable();

        // New node should have a different UUID
        expect(node2b.clusterService.getLocalMember().getUuid()).not.toBe(originalUuid);

        // Cluster should see 2 members again
        expect(node1.clusterService.getMembers()).toHaveLength(2);
        expect(node2b.clusterService.getMembers()).toHaveLength(2);
    });
});
