import { MutableLong } from '@zenystx/core/internal/util/MutableLong';

/**
 * Non thread-safe counter of items.
 * Port of com.hazelcast.internal.util.ItemCounter.
 */
export class ItemCounter<T> {
  protected readonly map = new Map<T, MutableLong>();
  private _total = 0;

  total(): number {
    return this._total;
  }

  keySet(): Set<T> {
    return new Set(this.map.keys());
  }

  descendingKeys(): T[] {
    const entries = [...this.map.entries()];
    entries.sort((a, b) => b[1].value - a[1].value);
    return entries.map(e => e[0]);
  }

  get(item: T): number {
    return this.map.get(item)?.value ?? 0;
  }

  set(item: T, value: number): void {
    const entry = this.map.get(item);
    if (entry == null) {
      this.map.set(item, MutableLong.valueOf(value));
      this._total += value;
    } else {
      this._total -= entry.value;
      this._total += value;
      entry.value = value;
    }
  }

  inc(item: T): void {
    this.add(item, 1);
  }

  add(item: T, delta: number): void {
    const entry = this.map.get(item);
    if (entry == null) {
      this.map.set(item, MutableLong.valueOf(delta));
    } else {
      entry.value += delta;
    }
    this._total += delta;
  }

  reset(): void {
    for (const entry of this.map.values()) {
      entry.value = 0;
    }
    this._total = 0;
  }

  clear(): void {
    this.map.clear();
    this._total = 0;
  }

  getAndSet(item: T, value: number): number {
    const entry = this.map.get(item);
    if (entry == null) {
      this.map.set(item, MutableLong.valueOf(value));
      this._total += value;
      return 0;
    }
    const oldValue = entry.value;
    this._total = this._total - oldValue + value;
    entry.value = value;
    return oldValue;
  }

  remove(item: T): void {
    const entry = this.map.get(item);
    if (entry != null) {
      this._total -= entry.value;
      this.map.delete(item);
    }
  }

  toString(): string {
    return this.map.toString();
  }
}
