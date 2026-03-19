/**
 * Binary Merkle tree for WAN anti-entropy consistency checks.
 *
 * The tree is built from a flat map of (key → serialized value) pairs.
 * Leaf nodes correspond to individual entries; internal nodes carry
 * the SHA-256 hash of their children's concatenated hashes.
 *
 * Uses Bun's built-in CryptoHasher for SHA-256 computation.
 */

// ── MerkleTreeNode ────────────────────────────────────────────────────────────

export class MerkleTreeNode {
    hash: Buffer;
    left: MerkleTreeNode | null = null;
    right: MerkleTreeNode | null = null;

    constructor(hash: Buffer) {
        this.hash = hash;
    }

    isLeaf(): boolean {
        return this.left === null && this.right === null;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(data: Buffer | string): Buffer {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(data);
    return Buffer.from(hasher.digest('hex'), 'hex');
}

function combineHashes(left: Buffer, right: Buffer): Buffer {
    const combined = Buffer.concat([left, right]);
    return sha256(combined);
}

const EMPTY_HASH = sha256(Buffer.alloc(0));

// ── MerkleTree ────────────────────────────────────────────────────────────────

export class MerkleTree {
    /** Depth of the tree (leaf count = 2^depth). */
    readonly depth: number;
    /** Root of the tree. Rebuilt on buildFromEntries(). */
    root: MerkleTreeNode;

    /**
     * Maps entry keys to their leaf nodes for O(1) update access.
     * The leaf index is determined by a hash of the key modulo leaf count.
     */
    private readonly _leafNodes: MerkleTreeNode[];
    /** Number of leaves = 2^depth. */
    private readonly _leafCount: number;
    /** Cached list of all entry keys mapped to each leaf bucket. */
    private readonly _leafBuckets: Map<number, Map<string, Buffer>>;

    constructor(depth = 8) {
        this.depth = depth;
        this._leafCount = 1 << depth; // 2^depth
        this._leafBuckets = new Map();
        this._leafNodes = [];
        for (let i = 0; i < this._leafCount; i++) {
            this._leafBuckets.set(i, new Map());
            this._leafNodes.push(new MerkleTreeNode(EMPTY_HASH));
        }
        this.root = this._buildTree(0, this._leafCount - 1);
    }

    /**
     * Build the entire tree from a snapshot of entries.
     * Replaces any previously computed state.
     */
    buildFromEntries(entries: Map<string, Buffer>): void {
        // Clear all buckets
        for (const bucket of this._leafBuckets.values()) {
            bucket.clear();
        }
        // Distribute entries into leaf buckets
        for (const [key, value] of entries) {
            const idx = this._leafIndexForKey(key);
            this._leafBuckets.get(idx)!.set(key, value);
        }
        // Recompute all leaf hashes
        for (let i = 0; i < this._leafCount; i++) {
            this._leafNodes[i].hash = this._computeLeafHash(i);
        }
        // Rebuild the tree structure
        this.root = this._buildTree(0, this._leafCount - 1);
    }

    /**
     * Returns the root node.
     */
    getRoot(): MerkleTreeNode {
        return this.root;
    }

    /**
     * Returns the hex-encoded SHA-256 hash for each leaf, ordered by leaf index
     * (0 … leafCount-1). Used to serialize the local tree state for wire transfer
     * so a remote peer can reconstruct an equivalent tree for comparison.
     */
    getLeafHashes(): string[] {
        return this._leafNodes.map((node) => node.hash.toString('hex'));
    }

    /**
     * Build a MerkleTree whose leaf hashes are set directly from the supplied
     * hex strings rather than being computed from entry buckets. The resulting
     * tree has the correct root hash and leaf hashes for Merkle comparison, but
     * its internal entry buckets are empty — it is suitable only for structural
     * comparison via {@link getDifferingLeaves}.
     */
    static fromLeafHashes(leafHashes: readonly string[]): MerkleTree {
        const leafCount = leafHashes.length;
        // depth = log2(leafCount); fall back to 8 if the count is not a power of two
        const depth = leafCount > 0 ? Math.round(Math.log2(leafCount)) : 8;
        const tree = new MerkleTree(depth);
        for (let i = 0; i < Math.min(leafCount, tree._leafNodes.length); i++) {
            tree._leafNodes[i].hash = Buffer.from(leafHashes[i], 'hex');
        }
        tree.root = tree._buildTree(0, tree._leafCount - 1);
        return tree;
    }

    /**
     * Update a single entry and recompute affected hashes up the tree.
     */
    updateEntry(key: string, value: Buffer): void {
        const idx = this._leafIndexForKey(key);
        this._leafBuckets.get(idx)!.set(key, value);
        this._recomputeLeaf(idx);
    }

    /**
     * Remove a single entry and recompute affected hashes up the tree.
     */
    removeEntry(key: string): void {
        const idx = this._leafIndexForKey(key);
        this._leafBuckets.get(idx)!.delete(key);
        this._recomputeLeaf(idx);
    }

    /**
     * Compare this tree against another and return the list of entry keys
     * whose leaf buckets differ between the two trees.
     */
    getDifferingLeaves(other: MerkleTree): string[] {
        const differingKeys: string[] = [];
        this._collectDifferingLeaves(this.root, other.root, differingKeys, other);
        return differingKeys;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _leafIndexForKey(key: string): number {
        const hash = sha256(Buffer.from(key, 'utf8'));
        // Use the first 4 bytes as an unsigned integer, mod leafCount
        const val = hash.readUInt32BE(0);
        return val % this._leafCount;
    }

    private _computeLeafHash(leafIdx: number): Buffer {
        const bucket = this._leafBuckets.get(leafIdx)!;
        if (bucket.size === 0) {
            return EMPTY_HASH;
        }
        // Sort keys for determinism, then hash each key-value pair
        const hasher = new Bun.CryptoHasher('sha256');
        for (const k of [...bucket.keys()].sort()) {
            hasher.update(k);
            hasher.update(bucket.get(k)!);
        }
        return Buffer.from(hasher.digest('hex'), 'hex');
    }

    private _buildTree(start: number, end: number): MerkleTreeNode {
        if (start === end) {
            return this._leafNodes[start];
        }
        const mid = Math.floor((start + end) / 2);
        const left = this._buildTree(start, mid);
        const right = this._buildTree(mid + 1, end);
        const node = new MerkleTreeNode(combineHashes(left.hash, right.hash));
        node.left = left;
        node.right = right;
        return node;
    }

    private _recomputeLeaf(leafIdx: number): void {
        this._leafNodes[leafIdx].hash = this._computeLeafHash(leafIdx);
        // Rebuild tree from scratch for simplicity; could be optimized to
        // walk up the path for large trees
        this.root = this._buildTree(0, this._leafCount - 1);
    }

    private _collectDifferingLeaves(
        nodeA: MerkleTreeNode,
        nodeB: MerkleTreeNode,
        result: string[],
        other: MerkleTree,
    ): void {
        // If hashes match, the entire subtree is identical
        if (nodeA.hash.equals(nodeB.hash)) {
            return;
        }
        // If both are leaves, collect all keys from this leaf bucket
        if (nodeA.isLeaf()) {
            // Find leaf index by reference comparison
            const leafIdx = this._leafNodes.indexOf(nodeA as MerkleTreeNode);
            if (leafIdx !== -1) {
                const localKeys = new Set(this._leafBuckets.get(leafIdx)!.keys());
                const remoteKeys = new Set(other._leafBuckets.get(leafIdx)?.keys() ?? []);
                // Collect keys that differ (present in local but not remote, or different values)
                for (const k of localKeys) {
                    const localVal = this._leafBuckets.get(leafIdx)!.get(k);
                    const remoteVal = other._leafBuckets.get(leafIdx)?.get(k);
                    if (remoteVal === undefined || !localVal!.equals(remoteVal)) {
                        result.push(k);
                    }
                }
                // Also collect keys present in remote but not in local
                for (const k of remoteKeys) {
                    if (!localKeys.has(k)) {
                        result.push(k);
                    }
                }
            }
            return;
        }
        // Recurse into children
        if (nodeA.left !== null && nodeB.left !== null) {
            this._collectDifferingLeaves(nodeA.left, nodeB.left, result, other);
        }
        if (nodeA.right !== null && nodeB.right !== null) {
            this._collectDifferingLeaves(nodeA.right, nodeB.right, result, other);
        }
    }
}
