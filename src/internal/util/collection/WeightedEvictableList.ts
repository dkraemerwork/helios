/**
 * A list that keeps items up to a max capacity. Once maxSize is reached,
 * half the entries with less weight are evicted.
 * Port of com.hazelcast.internal.util.collection.WeightedEvictableList.
 */
export class WeightedEvictableList<T> {
  private _list: WeightedItem<T>[] = [];
  private readonly maxSize: number;
  private readonly maxVotesBeforeReorganization: number;
  private reorganizationCounter = 0;

  constructor(maxSize: number, maxVotesBeforeReorganization: number) {
    this.maxSize = maxSize;
    this.maxVotesBeforeReorganization = maxVotesBeforeReorganization;
  }

  getList(): WeightedItem<T>[] {
    return this._list;
  }

  voteFor(weightedItem: WeightedItem<T>): void {
    this.reorganizationCounter++;
    weightedItem['vote']();
    if (this.reorganizationCounter === this.maxVotesBeforeReorganization) {
      this.reorganizationCounter = 0;
      this._organizeAndAdd(null);
    }
  }

  addOrVote(item: T): WeightedItem<T> {
    for (const wi of this._list) {
      if (wi.item === item || (wi.item as unknown as { equals?: (o: T) => boolean }).equals?.(item)) {
        this.voteFor(wi);
        return wi;
      }
      // Use value equality for primitives/strings
      if (wi.item === item) {
        this.voteFor(wi);
        return wi;
      }
    }
    // Check string/primitive equality more carefully
    for (const wi of this._list) {
      if (Object.is(wi.item, item)) {
        this.voteFor(wi);
        return wi;
      }
    }
    return this._organizeAndAdd(item)!;
  }

  getWeightedItem(index: number): WeightedItem<T> {
    return this._list[index];
  }

  size(): number {
    return this._list.length;
  }

  _organizeAndAdd(item: T | null): WeightedItem<T> | null {
    this._list.sort((a, b) => b.weight - a.weight);
    if (this._list.length === this.maxSize) {
      if (item !== null) {
        // Remove bottom half
        const halfSize = Math.floor(this.maxSize / 2);
        this._list.splice(halfSize);
        // Reset weights
        for (const wi of this._list) wi.weight = 0;
      }
    }
    if (item === null) return null;
    const newItem = new WeightedItem<T>(item);
    newItem.weight = 1;
    this._list.push(newItem);
    return newItem;
  }
}

export class WeightedItem<T> {
  readonly item: T;
  weight: number;

  constructor(item: T) {
    this.item = item;
    this.weight = 0;
  }

  private vote(): void {
    this.weight++;
  }

  getItem(): T {
    return this.item;
  }
}
