/**
 * Async-capable proxy for a distributed IList backed by DistributedListService.
 *
 * The distributed variant returns Promises for all operations. HeliosInstanceImpl
 * stores these as the list cache value and casts to IList<E> for the return type.
 */
import { DistributedListService } from "@zenystx/helios-core/collection/impl/list/DistributedListService";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";

export class ListProxyImpl<E> {
  constructor(
    private readonly _name: string,
    private readonly _service: DistributedListService,
    private readonly _ss: SerializationService,
  ) {}

  getName(): string {
    return this._name;
  }

  // ── ICollection ──────────────────────────────────────────────────────

  size(): Promise<number> {
    return this._service.size(this._name);
  }

  isEmpty(): Promise<boolean> {
    return this._service.isEmpty(this._name);
  }

  add(element: E): Promise<boolean> {
    return this._service.add(this._name, this._toData(element));
  }

  addAll(elements: E[]): Promise<boolean> {
    return this._service.addAll(
      this._name,
      elements.map((e) => this._toData(e)),
    );
  }

  async remove(element: E): Promise<boolean> {
    return this._service.remove(this._name, this._toData(element));
  }

  async removeAll(elements: E[]): Promise<boolean> {
    const all = await this._service.toArray(this._name);
    const toRemove = elements.map((e) => this._toData(e));
    const survivors = all.filter(
      (item) => !toRemove.some((r) => r.equals(item)),
    );
    if (survivors.length === all.length) return false;
    await this._service.clear(this._name);
    if (survivors.length > 0) {
      await this._service.addAll(this._name, survivors);
    }
    return true;
  }

  async retainAll(elements: E[]): Promise<boolean> {
    const all = await this._service.toArray(this._name);
    const keep = elements.map((e) => this._toData(e));
    const survivors = all.filter((item) => keep.some((k) => k.equals(item)));
    if (survivors.length === all.length) return false;
    await this._service.clear(this._name);
    if (survivors.length > 0) {
      await this._service.addAll(this._name, survivors);
    }
    return true;
  }

  contains(element: E): Promise<boolean> {
    return this._service.contains(this._name, this._toData(element));
  }

  containsAll(elements: E[]): Promise<boolean> {
    return this._service.containsAll(
      this._name,
      elements.map((e) => this._toData(e)),
    );
  }

  clear(): Promise<void> {
    return this._service.clear(this._name);
  }

  async toArray(): Promise<E[]> {
    const items = await this._service.toArray(this._name);
    return items.map((d) => this._toObject<E>(d));
  }

  async iterator(): Promise<Iterator<E> & { remove(): never }> {
    const snapshot = await this.toArray();
    let pos = 0;
    return {
      next(): IteratorResult<E> {
        if (pos < snapshot.length) {
          return { value: snapshot[pos++], done: false };
        }
        return { value: undefined as unknown as E, done: true };
      },
      remove(): never {
        throw new Error("UnsupportedOperationException");
      },
    };
  }

  // ── IList ────────────────────────────────────────────────────────────

  async get(index: number): Promise<E> {
    const d = await this._service.get(this._name, index);
    return this._toObject<E>(d);
  }

  async set(index: number, element: E): Promise<E> {
    const old = await this._service.set(
      this._name,
      index,
      this._toData(element),
    );
    return this._toObject<E>(old);
  }

  addAt(index: number, element: E): Promise<void> {
    return this._service.addAt(this._name, index, this._toData(element));
  }

  addAllAt(index: number, elements: E[]): Promise<boolean> {
    return this._service.addAllAt(
      this._name,
      index,
      elements.map((e) => this._toData(e)),
    );
  }

  async removeAt(index: number): Promise<E> {
    const d = await this._service.removeAt(this._name, index);
    return this._toObject<E>(d);
  }

  indexOf(element: E): Promise<number> {
    return this._service.indexOf(this._name, this._toData(element));
  }

  lastIndexOf(element: E): Promise<number> {
    return this._service.lastIndexOf(this._name, this._toData(element));
  }

  async subList(fromIndex: number, toIndex: number): Promise<E[]> {
    const items = await this._service.subList(this._name, fromIndex, toIndex);
    return items.map((d) => this._toObject<E>(d));
  }

  async listIterator(startIndex = 0): Promise<{
    hasNext(): boolean;
    next(): E;
    remove(): never;
  }> {
    const snapshot = await this.toArray();
    let pos = startIndex;
    return {
      hasNext(): boolean {
        return pos < snapshot.length;
      },
      next(): E {
        if (pos >= snapshot.length) {
          throw new Error("NoSuchElementException");
        }
        return snapshot[pos++];
      },
      remove(): never {
        throw new Error("UnsupportedOperationException");
      },
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _toData(value: unknown): Data {
    const data = this._ss.toData(value);
    if (data === null) throw new Error("NullPointerException: null element");
    return data;
  }

  private _toObject<T>(data: Data): T {
    return this._ss.toObject<T>(data) as T;
  }
}
