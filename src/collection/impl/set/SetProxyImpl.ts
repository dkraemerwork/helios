/**
 * Async-capable proxy for a distributed ISet backed by DistributedSetService.
 */
import { DistributedSetService } from "@zenystx/helios-core/collection/impl/set/DistributedSetService";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";

export class SetProxyImpl<E> {
  constructor(
    private readonly _name: string,
    private readonly _service: DistributedSetService,
    private readonly _ss: SerializationService,
  ) {}

  getName(): string {
    return this._name;
  }

  size(): Promise<number> {
    return this._service.size(this._name);
  }

  isEmpty(): Promise<boolean> {
    return this._service.isEmpty(this._name);
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

  add(element: E): Promise<boolean> {
    return this._service.add(this._name, this._toData(element));
  }

  addAll(elements: E[]): Promise<boolean> {
    return this._service.addAll(
      this._name,
      elements.map((e) => this._toData(e)),
    );
  }

  remove(element: E): Promise<boolean> {
    return this._service.remove(this._name, this._toData(element));
  }

  removeAll(elements: E[]): Promise<boolean> {
    return this._service.removeAll(
      this._name,
      elements.map((e) => this._toData(e)),
    );
  }

  retainAll(elements: E[]): Promise<boolean> {
    return this._service.retainAll(
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

  private _toData(value: unknown): Data {
    const data = this._ss.toData(value);
    if (data === null) throw new Error("NullPointerException: null element");
    return data;
  }

  private _toObject<T>(data: Data): T {
    return this._ss.toObject<T>(data) as T;
  }
}
