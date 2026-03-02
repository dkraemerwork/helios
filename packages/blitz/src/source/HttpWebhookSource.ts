import { JsonCodec, type BlitzCodec } from '../codec/BlitzCodec.ts';
import type { Source, SourceMessage } from './Source.ts';

class HttpWebhookSourceImpl<T> implements Source<T> {
  readonly name: string;
  readonly codec: BlitzCodec<T>;
  private readonly _port: number;
  private readonly _path: string;

  constructor(port: number, path: string, codec: BlitzCodec<T>) {
    this._port = port;
    this._path = path;
    this.codec = codec;
    this.name = `http-webhook-source:${port}${path}`;
  }

  async *messages(): AsyncIterable<SourceMessage<T>> {
    const pending: T[] = [];
    let resolve: (() => void) | null = null;

    const codec = this.codec;
    const targetPath = this._path;

    const server = Bun.serve({
      port: this._port,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (req.method !== 'POST' || url.pathname !== targetPath) {
          return new Response('Not Found', { status: 404 });
        }
        const buf = await req.arrayBuffer();
        const value = codec.decode(new Uint8Array(buf));
        pending.push(value);
        const r = resolve;
        resolve = null;
        r?.();
        return new Response('OK', { status: 200 });
      },
    });

    try {
      while (true) {
        if (pending.length > 0) {
          const value = pending.shift()!;
          yield {
            value,
            ack: () => {},
            nak: () => {},
          };
        } else {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      }
    } finally {
      server.stop();
    }
  }
}

/** Factory for HTTP webhook streaming sources (unbounded). */
export const HttpWebhookSource = {
  /**
   * Start a `Bun.serve()` HTTP endpoint that yields each incoming POST body.
   * The server starts when `messages()` iteration begins and stops when closed.
   * Defaults to `JsonCodec` if no codec provided.
   */
  listen<T = unknown>(port: number, path: string, codec?: BlitzCodec<T>): Source<T> {
    return new HttpWebhookSourceImpl<T>(port, path, (codec ?? JsonCodec<T>()) as BlitzCodec<T>);
  },
};
