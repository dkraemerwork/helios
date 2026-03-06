import { JsonWriter } from '@zenystx/helios-core/internal/json/JsonWriter';
import { Writer } from '@zenystx/helios-core/internal/json/Writer';

/** Controls the formatting of JSON output (minimal or pretty-printed). */
export abstract class WriterConfig {
  /** Minimal (compact) output — no whitespace. */
  static readonly MINIMAL: WriterConfig = new class extends WriterConfig {
    createWriter(writer: Writer): JsonWriter {
      return new JsonWriter(writer);
    }
  }();

  abstract createWriter(writer: Writer): JsonWriter;
}
