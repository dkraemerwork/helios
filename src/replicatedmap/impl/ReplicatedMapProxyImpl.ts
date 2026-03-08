/**
 * Typed proxy for a distributed ReplicatedMap backed by DistributedReplicatedMapService.
 */
import type { ReplicatedMap } from "@zenystx/helios-core/replicatedmap/ReplicatedMap";
import { DistributedReplicatedMapService } from "@zenystx/helios-core/replicatedmap/impl/DistributedReplicatedMapService";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";

export class ReplicatedMapProxyImpl<K, V> implements ReplicatedMap<K, V> {
  constructor(
    private readonly _name: string,
    private readonly _service: DistributedReplicatedMapService,
    private readonly _ss: SerializationService,
  ) {}

  getName(): string {
    return this._name;
  }

  put(key: K, value: V): V | null {
    const old = this._service.put(
      this._name,
      this._toData(key),
      this._toData(value),
    );
    return old === null ? null : this._toObject<V>(old);
  }

  get(key: K): V | null {
    const data = this._service.get(this._name, this._toData(key));
    return data === null ? null : this._toObject<V>(data);
  }

  remove(key: K): V | null {
    const data = this._service.remove(this._name, this._toData(key));
    return data === null ? null : this._toObject<V>(data);
  }

  containsKey(key: K): boolean {
    return this._service.containsKey(this._name, this._toData(key));
  }

  containsValue(value: V): boolean {
    return this._service.containsValue(this._name, this._toData(value));
  }

  size(): number {
    return this._service.size(this._name);
  }

  isEmpty(): boolean {
    return this._service.isEmpty(this._name);
  }

  clear(): void {
    this._service.clear(this._name);
  }

  keySet(): K[] {
    return this._service.keySet(this._name).map((d) => this._toObject<K>(d));
  }

  values(): V[] {
    return this._service.values(this._name).map((d) => this._toObject<V>(d));
  }

  entrySet(): [K, V][] {
    return this._service
      .entrySet(this._name)
      .map(([k, v]) => [this._toObject<K>(k), this._toObject<V>(v)]);
  }

  putAll(entries: [K, V][]): void {
    this._service.putAll(
      this._name,
      entries.map(([k, v]) => [this._toData(k), this._toData(v)]),
    );
  }

  destroy(): void {
    this._service.clear(this._name);
  }

  private _toData(value: unknown): Data {
    const data = this._ss.toData(value);
    if (data === null) throw new Error("NullPointerException: null key/value");
    return data;
  }

  private _toObject<T>(data: Data): T {
    return this._ss.toObject<T>(data) as T;
  }
}
