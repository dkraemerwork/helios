/**
 * Tests for TestClusterRegistry — in-process cluster simulation for unit tests.
 *
 * Covers: member registration/unregistration, partition round-robin assignment,
 * partition owner lookup, and registry reset.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { TestClusterRegistry, PARTITION_COUNT } from '@zenystx/helios-core/test-support/TestClusterRegistry';
import { TestHeliosInstance } from '@zenystx/helios-core/test-support/TestHeliosInstance';

describe('TestClusterRegistry', () => {
    let registry: TestClusterRegistry;

    beforeEach(() => {
        registry = new TestClusterRegistry();
    });

    // ── registration ──────────────────────────────────────────────────────────

    it('starts empty', () => {
        expect(registry.getMemberIds()).toHaveLength(0);
        expect(registry.size()).toBe(0);
    });

    it('register() with explicit instance returns a non-empty memberId', () => {
        const instance = new TestHeliosInstance();
        const id = registry.register(instance);
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
    });

    it('register() with no argument creates a new TestHeliosInstance', () => {
        const id = registry.register();
        expect(registry.getMember(id)).toBeInstanceOf(TestHeliosInstance);
    });

    it('register() each member gets a unique id', () => {
        const id1 = registry.register();
        const id2 = registry.register();
        const id3 = registry.register();
        expect(id1).not.toBe(id2);
        expect(id2).not.toBe(id3);
        expect(id1).not.toBe(id3);
    });

    it('getMemberIds() returns all registered ids', () => {
        const id1 = registry.register();
        const id2 = registry.register();
        const ids = registry.getMemberIds();
        expect(ids).toContain(id1);
        expect(ids).toContain(id2);
        expect(ids).toHaveLength(2);
    });

    it('getMember() returns the registered instance', () => {
        const instance = new TestHeliosInstance();
        const id = registry.register(instance);
        expect(registry.getMember(id)).toBe(instance);
    });

    it('getMember() returns undefined for unknown id', () => {
        expect(registry.getMember('no-such-id')).toBeUndefined();
    });

    it('size() reflects number of registered members', () => {
        expect(registry.size()).toBe(0);
        registry.register();
        expect(registry.size()).toBe(1);
        registry.register();
        expect(registry.size()).toBe(2);
    });

    // ── unregistration ────────────────────────────────────────────────────────

    it('unregister() removes the member', () => {
        const id = registry.register();
        expect(registry.unregister(id)).toBe(true);
        expect(registry.getMember(id)).toBeUndefined();
        expect(registry.size()).toBe(0);
    });

    it('unregister() returns false for unknown id', () => {
        expect(registry.unregister('no-such-id')).toBe(false);
    });

    // ── partition ownership ───────────────────────────────────────────────────

    it('getPartitionCount() returns 271', () => {
        expect(registry.getPartitionCount()).toBe(271);
        expect(PARTITION_COUNT).toBe(271);
    });

    it('getPartitionOwner() returns undefined when registry is empty', () => {
        expect(registry.getPartitionOwner(0)).toBeUndefined();
        expect(registry.getPartitionOwner(100)).toBeUndefined();
    });

    it('single member owns all partitions', () => {
        const instance = new TestHeliosInstance();
        registry.register(instance);
        for (let p = 0; p < 271; p++) {
            expect(registry.getPartitionOwner(p)).toBe(instance);
        }
    });

    it('two members: partitions split round-robin by insertion order', () => {
        const a = new TestHeliosInstance();
        const b = new TestHeliosInstance();
        registry.register(a);
        registry.register(b);

        // partition 0 → a (index 0 % 2 = 0), partition 1 → b, partition 2 → a, ...
        expect(registry.getPartitionOwner(0)).toBe(a);
        expect(registry.getPartitionOwner(1)).toBe(b);
        expect(registry.getPartitionOwner(2)).toBe(a);
        expect(registry.getPartitionOwner(3)).toBe(b);
        expect(registry.getPartitionOwner(270)).toBe(a); // 270 % 2 = 0 → a
    });

    it('three members: partitions split round-robin', () => {
        const a = new TestHeliosInstance();
        const b = new TestHeliosInstance();
        const c = new TestHeliosInstance();
        registry.register(a);
        registry.register(b);
        registry.register(c);

        expect(registry.getPartitionOwner(0)).toBe(a); // 0 % 3 = 0
        expect(registry.getPartitionOwner(1)).toBe(b); // 1 % 3 = 1
        expect(registry.getPartitionOwner(2)).toBe(c); // 2 % 3 = 2
        expect(registry.getPartitionOwner(3)).toBe(a); // 3 % 3 = 0
        expect(registry.getPartitionOwner(270)).toBe(a); // 270 % 3 = 0 → a
    });

    it('getPartitionsOwnedBy() returns correct partition ids for a member', () => {
        const a = new TestHeliosInstance();
        const b = new TestHeliosInstance();
        const idA = registry.register(a);
        const idB = registry.register(b);

        const partitionsA = registry.getPartitionsOwnedBy(idA);
        const partitionsB = registry.getPartitionsOwnedBy(idB);

        // Total partitions must equal PARTITION_COUNT
        expect(partitionsA.length + partitionsB.length).toBe(PARTITION_COUNT);

        // Every partition must appear exactly once
        const all = new Set([...partitionsA, ...partitionsB]);
        expect(all.size).toBe(PARTITION_COUNT);

        // Even partitions go to A (insertion order 0)
        expect(partitionsA).toContain(0);
        expect(partitionsA).toContain(2);
        expect(partitionsB).toContain(1);
        expect(partitionsB).toContain(3);
    });

    it('getPartitionsOwnedBy() returns empty array for unregistered id', () => {
        registry.register();
        expect(registry.getPartitionsOwnedBy('no-such-id')).toHaveLength(0);
    });

    it('isLocallyOwned() is false when registry empty', () => {
        expect(registry.isLocallyOwned(0)).toBe(false);
    });

    it('isLocallyOwned() uses the first registered member as "local"', () => {
        const a = new TestHeliosInstance();
        const b = new TestHeliosInstance();
        registry.register(a);
        registry.register(b);

        // partition 0 → a (local), partition 1 → b (remote)
        expect(registry.isLocallyOwned(0)).toBe(true);
        expect(registry.isLocallyOwned(1)).toBe(false);
    });

    // ── clear ─────────────────────────────────────────────────────────────────

    it('clear() removes all members', () => {
        registry.register();
        registry.register();
        registry.clear();
        expect(registry.size()).toBe(0);
        expect(registry.getMemberIds()).toHaveLength(0);
        expect(registry.getPartitionOwner(0)).toBeUndefined();
    });

    // ── getMembers() ──────────────────────────────────────────────────────────

    it('getMembers() returns instances in registration order', () => {
        const a = new TestHeliosInstance();
        const b = new TestHeliosInstance();
        registry.register(a);
        registry.register(b);
        const members = registry.getMembers();
        expect(members[0]).toBe(a);
        expect(members[1]).toBe(b);
    });
});
