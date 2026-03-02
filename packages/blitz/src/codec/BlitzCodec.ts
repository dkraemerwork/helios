/**
 * BlitzCodec<T> — encode/decode contract between typed pipeline values and raw bytes.
 *
 * All NATS-backed sources and sinks require a codec so that operator code
 * always works with typed `T` values, never raw `Uint8Array` payloads.
 */
export interface BlitzCodec<T> {
  /** Deserialize raw bytes into a typed value. */
  decode(payload: Uint8Array): T;
  /** Serialize a typed value to raw bytes. */
  encode(value: T): Uint8Array;
}

const _enc = new TextEncoder();
const _dec = new TextDecoder();

/** JSON codec — encodes via `JSON.stringify`, decodes via `JSON.parse`. */
export const JsonCodec = <T>(): BlitzCodec<T> => ({
  decode: (b) => JSON.parse(_dec.decode(b)) as T,
  encode: (v) => _enc.encode(JSON.stringify(v)),
});

/** String codec — encodes/decodes UTF-8 strings. */
export const StringCodec = (): BlitzCodec<string> => ({
  decode: (b) => _dec.decode(b),
  encode: (s) => _enc.encode(s),
});

/** Bytes codec — passthrough; payload is already a `Uint8Array`. */
export const BytesCodec = (): BlitzCodec<Uint8Array> => ({
  decode: (b) => b,
  encode: (b) => b,
});
