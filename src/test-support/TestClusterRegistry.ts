/**
 * TestClusterRegistry — in-process cluster simulation for unit tests.
 *
 * Holds an ordered list of TestHeliosInstance members. Partitions are
 * distributed round-robin across registered members in insertion order:
 *   owner(partitionId) = members[partitionId % members.length]
 *
 * No real TCP — all nodes share in-process memory. This is the foundation
 * for multi-node test scenarios (Block 4.1+).
 */
import { TestHeliosInstance } from '@zenystx/core/test-support/TestHeliosInstance';

export const PARTITION_COUNT = 271;

let _nextId = 0;

function generateMemberId(): string {
    return `test-member-${++_nextId}-${Date.now()}`;
}

export class TestClusterRegistry {
    /** Ordered list of (memberId, instance) pairs — insertion order = round-robin order. */
    private readonly _members: Array<{ id: string; instance: TestHeliosInstance }> = [];

    // ── registration ──────────────────────────────────────────────────────────

    /**
     * Register a member. If no instance is provided, a new TestHeliosInstance
     * is created. Returns the assigned memberId.
     */
    register(instance?: TestHeliosInstance): string {
        const id = generateMemberId();
        this._members.push({ id, instance: instance ?? new TestHeliosInstance() });
        return id;
    }

    /**
     * Unregister a member by id. Returns true if the member was found and
     * removed, false otherwise.
     */
    unregister(memberId: string): boolean {
        const idx = this._members.findIndex(m => m.id === memberId);
        if (idx === -1) return false;
        this._members.splice(idx, 1);
        return true;
    }

    /** Remove all registered members. */
    clear(): void {
        this._members.length = 0;
    }

    // ── accessors ─────────────────────────────────────────────────────────────

    size(): number {
        return this._members.length;
    }

    getMemberIds(): string[] {
        return this._members.map(m => m.id);
    }

    getMember(memberId: string): TestHeliosInstance | undefined {
        return this._members.find(m => m.id === memberId)?.instance;
    }

    /** Returns all instances in insertion order. */
    getMembers(): TestHeliosInstance[] {
        return this._members.map(m => m.instance);
    }

    // ── partition ownership ───────────────────────────────────────────────────

    getPartitionCount(): number {
        return PARTITION_COUNT;
    }

    /**
     * Returns the owning instance for a partition, or undefined if the registry
     * is empty. Ownership is round-robin by insertion order:
     *   owner = members[partitionId % members.length]
     */
    getPartitionOwner(partitionId: number): TestHeliosInstance | undefined {
        if (this._members.length === 0) return undefined;
        return this._members[partitionId % this._members.length].instance;
    }

    /**
     * Returns all partition IDs owned by the given member.
     * Returns an empty array if the memberId is not found.
     */
    getPartitionsOwnedBy(memberId: string): number[] {
        const idx = this._members.findIndex(m => m.id === memberId);
        if (idx === -1) return [];
        const count = this._members.length;
        const result: number[] = [];
        for (let p = 0; p < PARTITION_COUNT; p++) {
            if (p % count === idx) result.push(p);
        }
        return result;
    }

    /**
     * Returns true if the given partitionId is "locally" owned — i.e., owned
     * by the first registered member (the "local" node in test scenarios).
     */
    isLocallyOwned(partitionId: number): boolean {
        if (this._members.length === 0) return false;
        return partitionId % this._members.length === 0;
    }
}
