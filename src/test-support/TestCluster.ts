/**
 * TestCluster — manages N TestClusterNodes for integration testing.
 *
 * Provides high-level utilities:
 *   - startNode()     — starts a new node and joins the cluster
 *   - killNode(id)    — kills a node (simulates crash)
 *   - isolateNode(id) — blocks all TCP to/from a node (simulates partition)
 *   - waitForStable() — waits until all members agree on member list
 *   - getNodes()      — returns all live nodes
 *
 * Block 16.A0 — Multi-Node Test Infrastructure
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { MemberImpl } from '@zenystx/helios-core/cluster/impl/MemberImpl';
import { MembersView } from '@zenystx/helios-core/internal/cluster/impl/MembersView';
import { TestClusterNode, type TestClusterNodeConfig } from '@zenystx/helios-core/test-support/TestClusterNode';
import { MemberVersion } from '@zenystx/helios-core/version/MemberVersion';

export interface TestClusterConfig {
    readonly clusterName: string;
    readonly partitionCount: number;
    readonly heartbeatIntervalMillis?: number;
    readonly maxNoHeartbeatMillis?: number;
}

export class TestCluster {
    private readonly _config: TestClusterConfig;
    private readonly _nodes = new Map<string, TestClusterNode>();
    private readonly _isolated = new Set<string>();
    private _masterNodeId: string | null = null;

    constructor(config: TestClusterConfig) {
        this._config = config;
    }

    /**
     * Start a new node and join it to the cluster.
     * The first node becomes master automatically.
     */
    async startNode(opts?: { port?: number }): Promise<TestClusterNode> {
        const nodeConfig: TestClusterNodeConfig = {
            clusterName: this._config.clusterName,
            partitionCount: this._config.partitionCount,
            port: opts?.port,
            heartbeatIntervalMillis: this._config.heartbeatIntervalMillis,
            maxNoHeartbeatMillis: this._config.maxNoHeartbeatMillis,
        };

        const node = new TestClusterNode(nodeConfig);
        node.start(opts?.port ?? 0);

        if (this._masterNodeId === null) {
            // First node — become master
            node.becomeMaster();
            this._masterNodeId = node.nodeId;
        } else {
            // Join existing cluster via master
            const master = this._nodes.get(this._masterNodeId);
            if (!master || !master.isRunning) {
                throw new Error('Master node is not running');
            }

            const masterPort = master.boundPort!;

            // Single connection: new node connects to master (HELLO handshake is bidirectional)
            await node.transport.connectToPeer('127.0.0.1', masterPort);

            // Wait for HELLO handshake
            await this._waitForPeerCount(node, 1, 2000);
            await this._waitForPeerCount(master, this._nodes.size, 2000);

            // Master handles join: create new member, add to member list
            const joinerAddress = new Address('127.0.0.1', node.boundPort!);
            const joinerMember = new MemberImpl.Builder(joinerAddress)
                .uuid(node.nodeId)
                .version(new MemberVersion(1, 0, 0))
                .build();

            const joinResult = master.joinManager.handleJoinRequest(
                joinerMember, this._config.clusterName, this._config.partitionCount,
            );

            if (!joinResult.accepted) {
                throw new Error(`Join rejected: ${joinResult.reason}`);
            }

            // Master processes join
            await master.joinManager.startJoin([joinerMember]);

            // Build wire members from master's updated member list
            const members = master.clusterService.getMembers() as MemberImpl[];
            const masterAddr = master.clusterService.getMasterAddress()!;
            const memberMap = master.clusterService.getMemberMap();

            // Reconstruct members with correct localMember flags for the joiner
            const joinerMembers = members.map(m => {
                const isLocal = m.getUuid() === node.nodeId;
                return new MemberImpl.Builder(m.getAddress())
                    .uuid(m.getUuid())
                    .version(m.getVersion())
                    .localMember(isLocal)
                    .attributes(m.getAttributes())
                    .memberListJoinVersion(m.getMemberListJoinVersion())
                    .build();
            });

            const joinerView = MembersView.createNew(memberMap.getVersion(), joinerMembers);
            node.clusterService.setMasterAddress(masterAddr);
            node.clusterService.setMemberMap(joinerView.toMemberMap());
            node.clusterService.setClusterId(master.clusterService.getClusterId()!);
            node.clusterService.setJoined(true);

            // Update existing non-master nodes with new member list
            for (const [existingId, existingNode] of this._nodes) {
                if (existingId === this._masterNodeId) continue;
                if (this._isolated.has(existingId)) continue;

                const existingMembers = members.map(m => {
                    const isLocal = m.getUuid() === existingId;
                    return new MemberImpl.Builder(m.getAddress())
                        .uuid(m.getUuid())
                        .version(m.getVersion())
                        .localMember(isLocal)
                        .attributes(m.getAttributes())
                        .memberListJoinVersion(m.getMemberListJoinVersion())
                        .build();
                });
                const existingView = MembersView.createNew(memberMap.getVersion(), existingMembers);
                existingNode.clusterService.setMemberMap(existingView.toMemberMap());

                // Single connection: new node connects to existing node
                await node.transport.connectToPeer('127.0.0.1', existingNode.boundPort!);
            }
        }

        node.startHeartbeats();
        this._nodes.set(node.nodeId, node);
        return node;
    }

    /**
     * Kill a node — simulates a crash by shutting down its transport.
     */
    async killNode(nodeId: string): Promise<void> {
        const node = this._nodes.get(nodeId);
        if (!node) return;

        await node.shutdown();
        this._nodes.delete(nodeId);
        this._isolated.delete(nodeId);

        // If master was killed, elect a new master (first remaining node)
        if (nodeId === this._masterNodeId) {
            const remaining = [...this._nodes.values()];
            if (remaining.length > 0) {
                this._masterNodeId = remaining[0].nodeId;
                remaining[0].clusterService.setMasterAddress(
                    remaining[0].clusterService.getLocalMember().getAddress()
                );
            } else {
                this._masterNodeId = null;
            }
        }

        // Remove killed node from all surviving nodes' member lists
        for (const [, survivingNode] of this._nodes) {
            const currentMembers = (survivingNode.clusterService.getMembers() as MemberImpl[])
                .filter(m => m.getUuid() !== nodeId);
            const currentVersion = survivingNode.clusterService.getMemberMap().getVersion();

            const updatedMembers = currentMembers.map(m => {
                const isLocal = m.getUuid() === survivingNode.nodeId;
                return new MemberImpl.Builder(m.getAddress())
                    .uuid(m.getUuid())
                    .version(m.getVersion())
                    .localMember(isLocal)
                    .attributes(m.getAttributes())
                    .memberListJoinVersion(m.getMemberListJoinVersion())
                    .build();
            });

            const view = MembersView.createNew(currentVersion + 1, updatedMembers);
            survivingNode.clusterService.setMemberMap(view.toMemberMap());
        }
    }

    /**
     * Isolate a node — blocks heartbeats so the node will be suspected.
     * Implemented by disconnecting all TCP peers.
     */
    isolateNode(nodeId: string): void {
        const node = this._nodes.get(nodeId);
        if (!node) return;

        this._isolated.add(nodeId);

        // Disconnect all peers from/to this node
        for (const [otherId, otherNode] of this._nodes) {
            if (otherId === nodeId) continue;
            otherNode.transport.disconnectPeer(nodeId);
            node.transport.disconnectPeer(otherId);
        }
    }

    /**
     * Wait until all non-isolated nodes agree on their member lists.
     */
    async waitForStable(timeoutMs = 5000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const liveNodes = this._getLiveNodes();
            if (liveNodes.length === 0) return;

            let stable = true;
            const expectedCount = liveNodes.length;

            for (const node of liveNodes) {
                if (node.clusterService.getMembers().length !== expectedCount) {
                    stable = false;
                    break;
                }
                if (!node.clusterService.isJoined()) {
                    stable = false;
                    break;
                }
            }

            if (stable) return;
            await new Promise(r => setTimeout(r, 10));
        }
    }

    /**
     * Get all live (non-killed) nodes.
     */
    getNodes(): TestClusterNode[] {
        return [...this._nodes.values()];
    }

    /**
     * Get a specific node by ID.
     */
    getNode(nodeId: string): TestClusterNode | undefined {
        return this._nodes.get(nodeId);
    }

    /**
     * Shutdown all nodes.
     */
    async shutdown(): Promise<void> {
        for (const [, node] of this._nodes) {
            await node.shutdown();
        }
        this._nodes.clear();
        this._isolated.clear();
        this._masterNodeId = null;
    }

    // ── Internal ──────────────────────────────────────────────────────────

    private _getLiveNodes(): TestClusterNode[] {
        return [...this._nodes.values()].filter(n =>
            n.isRunning && !this._isolated.has(n.nodeId)
        );
    }

    private async _waitForPeerCount(node: TestClusterNode, count: number, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (node.transport.peerCount() < count && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 10));
        }
    }
}
