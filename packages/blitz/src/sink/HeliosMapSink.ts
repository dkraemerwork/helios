import type { IMap } from '@zenystx/helios-core/map/IMap';
import type { Sink } from './Sink.js';
import type { MapEntry } from '../source/HeliosMapSource.js';

class HeliosMapSinkImpl<K, V> implements Sink<MapEntry<K, V>> {
  readonly name: string;
  private readonly _map: IMap<K, V>;

  constructor(map: IMap<K, V>) {
    this._map = map;
    this.name = `helios-map-sink:${map.getName()}`;
  }

  async write(entry: MapEntry<K, V>): Promise<void> {
    await this._map.put(entry.key, entry.value);
  }
}

/** Factory for IMap-backed pipeline sinks. */
export const HeliosMapSink = {
  /**
   * Write `{ key, value }` pairs into the map via `IMap.put()`.
   * Idempotent — subsequent writes for the same key overwrite the previous value.
   */
  put<K, V>(map: IMap<K, V>): Sink<MapEntry<K, V>> {
    return new HeliosMapSinkImpl(map);
  },
};
