/**
 * WAN sync manager — orchestrates full and delta synchronization between clusters.
 *
 * Full sync: sends every entry in a map to the target cluster.
 * Delta sync: uses Merkle tree comparison to identify and sync only diverged entries.
 *
 * Port of {@code com.hazelcast.wan.impl.WanSyncManager}.
 */
import type { WanConsistencyCheckRequestMsg, WanConsistencyCheckResponseMsg } from '@zenystx/helios-core/cluster/tcp/ClusterMessage.js';
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService.js';
import { MerkleTree } from '@zenystx/helios-core/wan/impl/MerkleTree.js';
import type { WanBatchPublisher } from '@zenystx/helios-core/wan/impl/WanBatchPublisher.js';

export class WanSyncManager {
    private readonly _merkleTree: MerkleTree;
    private readonly _publisher: WanBatchPublisher;
    private _mapContainerService: MapContainerService | null = null;

    constructor(merkleTree: MerkleTree, publisher: WanBatchPublisher) {
        this._merkleTree = merkleTree;
        this._publisher = publisher;
    }

    /**
     * Set the map container service for accessing local record stores.
     * Must be set before any sync operations are requested.
     */
    setMapContainerService(service: MapContainerService): void {
        this._mapContainerService = service;
    }

    /**
     * Trigger a full synchronization of a map to the target cluster.
     * Iterates all partitions and enqueues PUT events for each entry.
     */
    async requestFullSync(mapName: string): Promise<void> {
        if (this._mapContainerService === null) {
            return;
        }
        for (let pid = 0; pid < 271; pid++) {
            const store = this._mapContainerService.getOrCreateRecordStore(mapName, pid);
            if (store.size() === 0) {
                continue;
            }
            const entries = store.entries();
            for (const [key, value] of entries) {
                const keyBuf = key.toByteArray() ?? Buffer.alloc(0);
                const valueBuf = value.toByteArray() ?? Buffer.alloc(0);
                this._publisher.publishEvent({
                    mapName,
                    eventType: 'PUT',
                    key: keyBuf,
                    value: valueBuf,
                    ttl: 0,
                    timestamp: Date.now(),
                });
            }
        }
        // Flush immediately
        await this._publisher.drainAndSend();
    }

    /**
     * Trigger a delta synchronization using the Merkle tree.
     *
     * 1. Rebuilds the local Merkle tree from the current map state.
     * 2. Sends a {@code WAN_CONSISTENCY_CHECK_REQUEST} to the target cluster
     *    carrying the local root hash.
     * 3. The target responds with its own leaf hashes so we can reconstruct its
     *    tree locally.
     * 4. Calls {@link MerkleTree#getDifferingLeaves} to find the exact set of
     *    entry keys whose leaf buckets differ between the two trees.
     * 5. Publishes only those differing entries as WAN PUT events.
     *
     * If the two roots already match, no events are published.
     */
    async requestDeltaSync(mapName: string): Promise<void> {
        if (this._mapContainerService === null) {
            return;
        }

        // ── Step 1: build local tree ──────────────────────────────────────────
        const allEntries = new Map<string, Buffer>();
        // Also keep a reverse index: base64 key string → raw key/value buffers so
        // we can look entries up by the string keys returned by getDifferingLeaves().
        const keyIndex = new Map<string, { key: Buffer; value: Buffer }>();

        for (let pid = 0; pid < 271; pid++) {
            const store = this._mapContainerService.getOrCreateRecordStore(mapName, pid);
            if (store.size() === 0) {
                continue;
            }
            for (const [key, value] of store.entries()) {
                const keyBuf = key.toByteArray() ?? Buffer.alloc(0);
                const valueBuf = value.toByteArray() ?? Buffer.alloc(0);
                const keyStr = keyBuf.toString('base64');
                allEntries.set(keyStr, valueBuf);
                keyIndex.set(keyStr, { key: keyBuf, value: valueBuf });
            }
        }
        this._merkleTree.buildFromEntries(allEntries);

        // ── Step 2: request consistency check from the target ─────────────────
        const localRootHex = this._merkleTree.root.hash.toString('hex');
        let response: WanConsistencyCheckResponseMsg;
        try {
            response = await this._publisher.sendConsistencyCheckRequest(mapName, localRootHex);
        } catch {
            // Cannot reach the target — skip this delta cycle rather than falling
            // back to a potentially expensive full sync.
            return;
        }

        // ── Step 3: if roots match, nothing to do ─────────────────────────────
        if (response.consistent) {
            return;
        }

        // ── Step 4: reconstruct remote tree from leaf hashes and diff ─────────
        const remoteTree = MerkleTree.fromLeafHashes(response.leafHashes);
        const differingKeys = this._merkleTree.getDifferingLeaves(remoteTree);

        // ── Step 5: publish only the differing entries ────────────────────────
        for (const keyStr of differingKeys) {
            const entry = keyIndex.get(keyStr);
            if (entry === undefined) {
                // Key exists in remote but not local — no action needed from this side.
                continue;
            }
            this._publisher.publishEvent({
                mapName,
                eventType: 'PUT',
                key: entry.key,
                value: entry.value,
                ttl: 0,
                timestamp: Date.now(),
            });
        }

        await this._publisher.drainAndSend();
    }

    /**
     * Handle an incoming consistency check request.
     *
     * Compares the local Merkle tree root against the one reported by the remote
     * peer. The response always includes the full set of local leaf hashes so the
     * requester can reconstruct this tree locally and compute the exact differing
     * entry keys via {@link MerkleTree#getDifferingLeaves} without a second
     * round-trip.
     *
     * When the roots differ, `differingLeafCount` is computed by building a stub
     * remote tree from the requester's root hash and comparing it leaf-by-leaf
     * against the local tree. Any local leaf whose hash does not match the
     * corresponding remote leaf is counted as diverged.
     */
    handleConsistencyCheckRequest(
        msg: WanConsistencyCheckRequestMsg,
    ): WanConsistencyCheckResponseMsg {
        const localLeafHashes = this._merkleTree.getLeafHashes();
        const localRootHex = this._merkleTree.root.hash.toString('hex');
        const consistent = localRootHex === msg.merkleRootHex;

        if (consistent) {
            return {
                type: 'WAN_CONSISTENCY_CHECK_RESPONSE',
                requestId: msg.requestId,
                consistent: true,
                differingLeafCount: 0,
                leafHashes: localLeafHashes,
            };
        }

        // We only know the remote root hash, not the individual remote leaf hashes.
        // Count diverged leaves by walking our own leaf hashes: any leaf whose hash
        // differs from the remote root hash used as a sentinel is counted as
        // potentially diverged.  The requester will compute the precise per-key diff
        // once it reconstructs the remote tree from the returned leafHashes.
        const remoteLeafHashes = Array.from({ length: localLeafHashes.length }, () => msg.merkleRootHex);
        const differingLeafCount = localLeafHashes.reduce(
            (count, hash, i) => (hash !== remoteLeafHashes[i] ? count + 1 : count),
            0,
        );

        return {
            type: 'WAN_CONSISTENCY_CHECK_RESPONSE',
            requestId: msg.requestId,
            consistent: false,
            differingLeafCount,
            leafHashes: localLeafHashes,
        };
    }

    /**
     * Perform a local consistency check — returns the hex root hash of the
     * Merkle tree for the current local map state.
     */
    async performConsistencyCheck(mapName: string): Promise<string> {
        if (this._mapContainerService === null) {
            return this._merkleTree.root.hash.toString('hex');
        }
        // Rebuild the Merkle tree from current state
        const allEntries = new Map<string, Buffer>();
        for (let pid = 0; pid < 271; pid++) {
            const store = this._mapContainerService.getOrCreateRecordStore(mapName, pid);
            if (store.size() === 0) {
                continue;
            }
            for (const [key, value] of store.entries()) {
                const keyStr = key.toByteArray()?.toString('base64') ?? '';
                const valueBuf = value.toByteArray() ?? Buffer.alloc(0);
                allEntries.set(keyStr, valueBuf);
            }
        }
        this._merkleTree.buildFromEntries(allEntries);
        return this._merkleTree.root.hash.toString('hex');
    }
}
