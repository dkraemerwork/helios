import { WeightedEvictableList } from '@zenystx/helios-core/internal/util/collection/WeightedEvictableList';
import { describe, expect, it } from 'bun:test';

describe('WeightedEvictableListTest', () => {
  it('testNewItemStartsWithOneVote', () => {
    const list = new WeightedEvictableList<string>(3, 3);
    list.addOrVote('a');
    expect(list.getList()[0].weight).toEqual(1);
  });

  it('testVoteFor', () => {
    const list = new WeightedEvictableList<string>(3, 3);
    const item = list.addOrVote('a');
    list.voteFor(item);
    expect(list.getList()[0].weight).toEqual(2);
  });

  it('testAddDoesNotDuplicate', () => {
    const list = new WeightedEvictableList<string>(3, 3);
    list.addOrVote('a');
    list.addOrVote('a');
    expect(list.size()).toEqual(1);
    expect(list.getList()[0].item).toEqual('a');
  });

  it('testDuplicateAddIncreasesWeight', () => {
    const list = new WeightedEvictableList<string>(3, 3);
    list.addOrVote('a');
    list.addOrVote('a');
    list.addOrVote('a');
    expect(list.size()).toEqual(1);
    expect(list.getList()[0].weight).toEqual(3);
  });

  it('testListReorganizesAfterEnoughVotes', () => {
    const list = new WeightedEvictableList<string>(3, 3);
    list.addOrVote('c');
    list.addOrVote('b');
    list.addOrVote('b');
    list.addOrVote('a');
    list.addOrVote('a');
    list.addOrVote('a');
    expect(list.getList().map(i => i.item)).toEqual(['a', 'b', 'c']);
    expect(list.getList().map(i => i.weight)).toEqual([3, 2, 1]);
  });

  it('testListReorganizesAfterMaxSize', () => {
    const list = new WeightedEvictableList<string>(3, 100);
    list.addOrVote('c');
    list.addOrVote('b');
    list.addOrVote('b');
    list.addOrVote('a');
    list.addOrVote('a');
    list.addOrVote('a');
    // Adding 4th triggers eviction (maxSize=3) → evicts bottom half
    list.addOrVote('d');
    expect(list.size()).toBeLessThanOrEqual(3);
  });

  it('testGetWeightedItem', () => {
    const list = new WeightedEvictableList<string>(3, 3);
    list.addOrVote('x');
    expect(list.getWeightedItem(0).item).toEqual('x');
  });
});
