/**
 * A mutable set of partition IDs backed by a BitArray.
 * Port of com.hazelcast.internal.util.collection.PartitionIdSet.
 */
export class PartitionIdSet implements Iterable<number> {
  private readonly _partitionCount: number;
  private readonly bits: Uint8Array;
  private _size = -1; // -1 means unknown (lazy compute)

  constructor(partitionCountOrSource: number | PartitionIdSet, initialIds?: number[] | PartitionIdSet) {
    if (partitionCountOrSource instanceof PartitionIdSet) {
      const src = partitionCountOrSource;
      this._partitionCount = src._partitionCount;
      this.bits = src.bits.slice();
      this._size = src._size;
    } else {
      this._partitionCount = partitionCountOrSource;
      this.bits = new Uint8Array(Math.ceil(partitionCountOrSource / 8));
      if (initialIds instanceof PartitionIdSet) {
        const src = initialIds;
        this.bits.set(src.bits);
        this._size = src._size;
      } else if (Array.isArray(initialIds)) {
        for (const id of initialIds) this._setBit(id, true);
        this._size = -1;
      }
    }
  }

  partitionCount(): number {
    return this._partitionCount;
  }

  private _setBit(id: number, value: boolean): void {
    if (value) {
      this.bits[id >>> 3] |= 1 << (id & 7);
    } else {
      this.bits[id >>> 3] &= ~(1 << (id & 7));
    }
    this._size = -1;
  }

  private _getBit(id: number): boolean {
    return (this.bits[id >>> 3] & (1 << (id & 7))) !== 0;
  }

  add(id: number): boolean {
    if (this._getBit(id)) return false;
    this._setBit(id, true);
    return true;
  }

  addAll(ids: number[] | PartitionIdSet): void {
    if (ids instanceof PartitionIdSet) {
      for (let i = 0; i < this.bits.length; i++) {
        this.bits[i] |= ids.bits[i];
      }
      this._size = -1;
    } else {
      for (const id of ids) this._setBit(id, true);
    }
  }

  remove(id: number): boolean {
    if (!this._getBit(id)) return false;
    this._setBit(id, false);
    return true;
  }

  removeAll(ids: PartitionIdSet): void {
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] &= ~ids.bits[i];
    }
    this._size = -1;
  }

  contains(id: number): boolean {
    return this._getBit(id);
  }

  containsAll(other: PartitionIdSet): boolean {
    for (let i = 0; i < this.bits.length; i++) {
      if ((this.bits[i] & other.bits[i]) !== other.bits[i]) return false;
    }
    return true;
  }

  size(): number {
    if (this._size < 0) {
      let count = 0;
      for (let i = 0; i < this._partitionCount; i++) {
        if (this._getBit(i)) count++;
      }
      this._size = count;
    }
    return this._size;
  }

  isEmpty(): boolean {
    return this.size() === 0;
  }

  clear(): void {
    this.bits.fill(0);
    this._size = 0;
  }

  complement(): void {
    for (let i = 0; i < this._partitionCount; i++) {
      this._setBit(i, !this._getBit(i));
    }
    this._size = -1;
  }

  union(other: PartitionIdSet): void {
    this.addAll(other);
  }

  [Symbol.iterator](): Iterator<number> {
    let i = 0;
    const self = this;
    return {
      next(): IteratorResult<number> {
        while (i < self._partitionCount) {
          const id = i++;
          if (self._getBit(id)) return { value: id, done: false };
        }
        return { value: 0, done: true };
      }
    };
  }

  /** Java-style int iterator over contained partition IDs. */
  intIterator(): IterableIterator<number> {
    const iter = this[Symbol.iterator]();
    const iterable: IterableIterator<number> = {
      next: () => iter.next() as IteratorResult<number, undefined>,
      [Symbol.iterator]() { return this; },
    };
    return iterable;
  }

  /** Return all contained partition IDs as a sorted array. */
  toArray(): number[] {
    const result: number[] = [];
    for (const id of this) result.push(id);
    return result;
  }
}
