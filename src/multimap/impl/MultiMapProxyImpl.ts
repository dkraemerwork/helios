/**
 * Typed proxy for a distributed MultiMap backed by DistributedMultiMapService.
 */
import type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";
import { DistributedMultiMapService } from "@zenystx/helios-core/multimap/impl/DistributedMultiMapService";
import { ValueCollectionType } from "@zenystx/helios-core/multimap/MultiMapConfig";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";

export class MultiMapProxyImpl<K, V> {
  constructor(
    private readonly _name: string,
    private readonly _service: DistributedMultiMapService,
    private readonly _ss: SerializationService,
    private readonly _type: ValueCollectionType = ValueCollectionType.LIST,
  ) {}

  getName(): string {
    return this._name;
  }

  async put(key: K, value: V): Promise<boolean> {
    return this._service.put(
      this._name,
      this._toData(key),
      this._toData(value),
      this._type,
    );
  }

  async get(key: K): Promise<{ size: number; has(v: V): boolean; [Symbol.iterator](): Iterator<V> }> {
    const items = await this._service.get(this._name, this._toData(key));
    const objects = items.map((d) => this._toObject<V>(d));
    return {
      get size() { return objects.length; },
      has(v: V): boolean { return objects.includes(v); },
      [Symbol.iterator](): Iterator<V> { return objects[Symbol.iterator](); },
    };
  }

  async removeAll(key: K): Promise<{ size: number; [Symbol.iterator](): Iterator<V> }> {
    const items = await this._service.removeAll(this._name, this._toData(key));
    const objects = items.map((d) => this._toObject<V>(d));
    return {
      get size() { return objects.length; },
      [Symbol.iterator](): Iterator<V> { return objects[Symbol.iterator](); },
    };
  }

  async remove(key: K, value: V): Promise<boolean> {
    return this._service.remove(
      this._name,
      this._toData(key),
      this._toData(value),
    );
  }

  async delete(key: K): Promise<void> {
    await this._service.removeAll(this._name, this._toData(key));
  }

  async size(): Promise<number> {
    return this._service.size(this._name);
  }

  async valueCount(key: K): Promise<number> {
    return this._service.valueCount(this._name, this._toData(key));
  }

  async keySet(): Promise<Set<K>> {
    const keys = await this._service.keySet(this._name);
    return new Set(keys.map((d) => this._toObject<K>(d)));
  }

  async values(): Promise<V[]> {
    const vals = await this._service.values(this._name);
    return vals.map((d) => this._toObject<V>(d));
  }

  async entrySet(): Promise<[K, V][]> {
    const pairs = await this._service.entrySet(this._name);
    return pairs.map(([k, v]) => [this._toObject<K>(k), this._toObject<V>(v)]);
  }

  async containsKey(key: K): Promise<boolean> {
    return this._service.containsKey(this._name, this._toData(key));
  }

  async containsValue(value: V): Promise<boolean> {
    return this._service.containsValue(this._name, this._toData(value));
  }

  async containsEntry(key: K, value: V): Promise<boolean> {
    return this._service.containsEntry(
      this._name,
      this._toData(key),
      this._toData(value),
    );
  }

  async clear(): Promise<void> {
    return this._service.clear(this._name);
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
