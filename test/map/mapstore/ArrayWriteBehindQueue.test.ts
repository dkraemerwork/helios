import { ArrayWriteBehindQueue } from '@zenystx/helios-core/map/impl/mapstore/writebehind/ArrayWriteBehindQueue';
import { addedEntry, deletedEntry } from '@zenystx/helios-core/map/impl/mapstore/writebehind/DelayedEntry';
import { describe, expect, it } from 'bun:test';

describe('ArrayWriteBehindQueue', () => {
  it('offer adds entry in FIFO order', () => {
    const q = new ArrayWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 100));
    q.offer(addedEntry('k2', 'v2', 200));
    expect(q.size()).toBe(2);
    expect(q.isEmpty()).toBe(false);
  });

  it('drainTo(now) removes from the front while storeTime <= now', () => {
    const q = new ArrayWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 100));
    q.offer(addedEntry('k2', 'v2', 200));
    q.offer(addedEntry('k3', 'v3', 300));

    const drained = q.drainTo(200);
    expect(drained.length).toBe(2);
    expect(drained[0].key).toBe('k1');
    expect(drained[1].key).toBe('k2');
    expect(q.size()).toBe(1);
  });

  it('no coalescing: same key gets two separate entries', () => {
    const q = new ArrayWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 100));
    q.offer(addedEntry('k1', 'v2', 200));

    expect(q.size()).toBe(2);  // no coalescing
    const all = q.drainAll();
    expect(all.length).toBe(2);
    expect(all[0].value).toBe('v1');
    expect(all[1].value).toBe('v2');
  });

  it('drainAll() returns all entries', () => {
    const q = new ArrayWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 100));
    q.offer(deletedEntry('k2', 200));

    const all = q.drainAll();
    expect(all.length).toBe(2);
    expect(q.isEmpty()).toBe(true);
  });

  it('clear() empties queue', () => {
    const q = new ArrayWriteBehindQueue<string, string>();
    q.offer(addedEntry('k1', 'v1', 100));
    q.clear();
    expect(q.isEmpty()).toBe(true);
    expect(q.size()).toBe(0);
  });
});
