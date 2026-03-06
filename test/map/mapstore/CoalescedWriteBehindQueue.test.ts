import { describe, it, expect } from 'bun:test';
import { CoalescedWriteBehindQueue } from '@zenystx/helios-core/map/impl/mapstore/writebehind/CoalescedWriteBehindQueue';
import { addedEntry, deletedEntry, DelayedEntryType } from '@zenystx/helios-core/map/impl/mapstore/writebehind/DelayedEntry';

describe('CoalescedWriteBehindQueue', () => {
  it('offer adds entry and size() increases', () => {
    const q = new CoalescedWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 100));
    expect(q.size()).toBe(1);
    expect(q.isEmpty()).toBe(false);
  });

  it('drainTo(now) returns entries with storeTime <= now', () => {
    const q = new CoalescedWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 100));
    q.offer(addedEntry('k2', 'v2', 200));
    q.offer(addedEntry('k3', 'v3', 300));

    const drained = q.drainTo(200);
    expect(drained.length).toBe(2);
    expect(drained.map(e => e.key)).toContain('k1');
    expect(drained.map(e => e.key)).toContain('k2');
    expect(q.size()).toBe(1);
  });

  it('coalescing: same key keeps original storeTime but updates value/type', () => {
    const q = new CoalescedWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'original', 100));
    q.offer(addedEntry('k1', 'updated', 200));  // same key, later storeTime

    // size should still be 1 (coalesced)
    expect(q.size()).toBe(1);

    // drain at 100 — original storeTime is kept, so it should drain
    const drained = q.drainTo(100);
    expect(drained.length).toBe(1);
    expect(drained[0].value).toBe('updated');  // value updated
    expect(drained[0].storeTime).toBe(100);    // original storeTime kept
  });

  it('coalescing: ADD followed by DELETE for same key keeps original storeTime', () => {
    const q = new CoalescedWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v', 100));
    q.offer(deletedEntry('k1', 200));

    expect(q.size()).toBe(1);
    const drained = q.drainTo(100);
    expect(drained.length).toBe(1);
    expect(drained[0].type).toBe(DelayedEntryType.DELETE);
    expect(drained[0].storeTime).toBe(100);
  });

  it('drainAll() returns all entries regardless of storeTime', () => {
    const q = new CoalescedWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 1000));
    q.offer(addedEntry('k2', 'v2', 2000));

    const all = q.drainAll();
    expect(all.length).toBe(2);
    expect(q.isEmpty()).toBe(true);
  });

  it('clear() empties the queue', () => {
    const q = new CoalescedWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 100));
    q.clear();
    expect(q.isEmpty()).toBe(true);
    expect(q.size()).toBe(0);
  });
});
