import { appendFile } from 'node:fs/promises';
import { StringCodec, type BlitzCodec } from '../codec/BlitzCodec.js';
import type { Sink } from './Sink.js';

class FileSinkImpl<T> implements Sink<T> {
  readonly name: string;
  private readonly _path: string;
  private readonly _codec: BlitzCodec<T>;

  constructor(path: string, codec: BlitzCodec<T>) {
    this._path = path;
    this._codec = codec;
    this.name = `file-sink:${path}`;
  }

  async write(value: T): Promise<void> {
    const dec = new TextDecoder();
    const line = dec.decode(this._codec.encode(value));
    await appendFile(this._path, `${line}\n`);
  }
}

/** Factory for file-backed pipeline sinks (append mode). */
export const FileSink = {
  /**
   * Append each value as a newline to the given file path.
   * NOT idempotent — retries will append duplicate lines.
   * Defaults to `StringCodec` if no codec is provided.
   */
  appendLines<T = string>(path: string, codec?: BlitzCodec<T>): Sink<T> {
    return new FileSinkImpl<T>(path, (codec ?? StringCodec()) as BlitzCodec<T>);
  },
};
