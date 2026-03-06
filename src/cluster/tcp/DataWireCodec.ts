import type { Data } from "@zenystx/core/internal/serialization/Data";
import { HeapData } from "@zenystx/core/internal/serialization/impl/HeapData";

export interface EncodedData {
  readonly bytes: string;
}

export function encodeData(data: Data): EncodedData {
  const bytes = data.toByteArray();
  if (bytes === null) {
    throw new Error("Cannot encode null Data");
  }
  return { bytes: bytes.toString("base64") };
}

export function decodeData(encoded: EncodedData): Data {
  return new HeapData(Buffer.from(encoded.bytes, "base64"));
}
