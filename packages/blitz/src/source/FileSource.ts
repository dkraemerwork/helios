import { StringCodec, type BlitzCodec } from '../codec/BlitzCodec.ts';
import type { Source, SourceMessage } from './Source.ts';

class FileSourceImpl<T> implements Source<T> {
  readonly name: string;
  readonly codec: BlitzCodec<T>;
  private readonly _path: string;

  constructor(path: string, codec: BlitzCodec<T>) {
    this._path = path;
    this.codec = codec;
    this.name = `file-source:${path}`;
  }

  async *messages(): AsyncIterable<SourceMessage<T>> {
    const text = await Bun.file(this._path).text();
    const enc = new TextEncoder();
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      const value = this.codec.decode(enc.encode(line));
      yield {
        value,
        ack: () => {},
        nak: () => {},
      };
    }
  }
}

/** Factory for file-backed batch sources (bounded). */
export const FileSource = {
  /**
   * Stream a file line-by-line as a batch source.
   * Empty lines are skipped. Defaults to `StringCodec` if no codec is provided.
   * ack/nak are no-ops.
   */
  lines<T = string>(path: string, codec?: BlitzCodec<T>): Source<T> {
    return new FileSourceImpl<T>(path, (codec ?? StringCodec()) as BlitzCodec<T>);
  },
};
