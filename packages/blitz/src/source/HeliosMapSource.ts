import type { IMap } from '@zenystx/core/map/IMap';
import { JsonCodec, type BlitzCodec } from '../codec/BlitzCodec.ts';
import type { Source, SourceMessage } from './Source.ts';

/** Entry type emitted by HeliosMapSource. */
export interface MapEntry<K, V> {
  key: K;
  value: V;
}

class HeliosMapSourceImpl<K, V> implements Source<MapEntry<K, V>> {
  readonly name: string;
  readonly codec: BlitzCodec<MapEntry<K, V>>;
  private readonly _map: IMap<K, V>;

  constructor(map: IMap<K, V>) {
    this._map = map;
    this.name = `helios-map-source:${map.getName()}`;
    this.codec = JsonCodec<MapEntry<K, V>>();
  }

  async *messages(): AsyncIterable<SourceMessage<MapEntry<K, V>>> {
    const entries = this._map.entrySet();
    for (const [key, value] of entries) {
      yield {
        value: { key, value },
        ack: () => {},  // batch source — atomically complete; ack is a no-op
        nak: () => {},  // batch source — nak is a no-op
      };
    }
  }
}

/** Factory for IMap snapshot sources (batch, bounded). */
export const HeliosMapSource = {
  /**
   * Take a one-time snapshot of all entries in the map.
   * Emits `{ key, value }` pairs then terminates (batch mode).
   * ack/nak are no-ops — the batch is atomic.
   */
  snapshot<K, V>(map: IMap<K, V>): Source<MapEntry<K, V>> {
    return new HeliosMapSourceImpl(map);
  },
};
