import { describe, it, expect } from 'bun:test';
import { ReplicatedMapEntryView } from '@helios/replicatedmap/impl/record/ReplicatedMapEntryView';

describe('EntryViewTest', () => {
  function createEntryView(): ReplicatedMapEntryView<string, string> {
    return new ReplicatedMapEntryView<string, string>()
      .setKey('foo')
      .setValue('bar')
      .setCreationTime(1)
      .setLastAccessTime(2)
      .setLastUpdateTime(3)
      .setHits(4)
      .setTtl(5);
  }

  function verifyFields(entryView: ReplicatedMapEntryView<string, string>): void {
    expect(entryView.getKey()).toBe('foo');
    expect(entryView.getValue()).toBe('bar');
    expect(entryView.getCreationTime()).toBe(1);
    expect(entryView.getLastAccessTime()).toBe(2);
    expect(entryView.getLastUpdateTime()).toBe(3);
    expect(entryView.getHits()).toBe(4);
    expect(entryView.getTtl()).toBe(5);
    expect(entryView.getExpirationTime()).toBe(-1);
    expect(entryView.getLastStoredTime()).toBe(-1);
    expect(entryView.getCost()).toBe(-1);
    expect(entryView.getVersion()).toBe(-1);
  }

  it('testEntryView', () => {
    const entryView = createEntryView();
    verifyFields(entryView);
  });
});
