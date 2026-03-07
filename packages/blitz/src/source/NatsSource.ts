import type { NatsConnection } from '@nats-io/transport-node';
import type { JetStreamClient } from '@nats-io/jetstream';
import type { BlitzCodec } from '../codec/BlitzCodec.js';
import type { Source, SourceMessage } from './Source.js';

class NatsSubjectSource<T> implements Source<T> {
  readonly name: string;
  readonly codec: BlitzCodec<T>;
  private readonly _nc: NatsConnection;
  private readonly _subject: string;

  constructor(nc: NatsConnection, subject: string, codec: BlitzCodec<T>) {
    this._nc = nc;
    this._subject = subject;
    this.codec = codec;
    this.name = `nats-subject:${subject}`;
  }

  async *messages(): AsyncIterable<SourceMessage<T>> {
    const sub = this._nc.subscribe(this._subject);
    for await (const msg of sub) {
      yield {
        value: this.codec.decode(msg.data),
        ack: () => {},
        nak: (_delay?: number) => {},
      };
    }
  }
}

class NatsStreamSource<T> implements Source<T> {
  readonly name: string;
  readonly codec: BlitzCodec<T>;
  private readonly _js: JetStreamClient;
  private readonly _stream: string;
  private readonly _consumer: string;

  constructor(js: JetStreamClient, stream: string, consumer: string, codec: BlitzCodec<T>) {
    this._js = js;
    this._stream = stream;
    this._consumer = consumer;
    this.codec = codec;
    this.name = `nats-stream:${stream}/${consumer}`;
  }

  async *messages(): AsyncIterable<SourceMessage<T>> {
    const consumer = await this._js.consumers.get(this._stream, this._consumer);
    const iter = await consumer.consume();
    for await (const msg of iter) {
      yield {
        value: this.codec.decode(msg.data),
        ack: () => msg.ack(),
        nak: (delay?: number) => msg.nak(delay),
      };
    }
  }
}

/**
 * Factory for NATS-backed pipeline sources.
 *
 * Note: The connection (`nc` / `js`) is provided at construction time for Block 10.2.
 * When the full pipeline execution engine is available (Block 10.3+), BlitzService
 * will inject the connection automatically at submit time.
 */
export const NatsSource = {
  /**
   * Subscribe to a NATS core subject (push subscription).
   * Subject may include wildcards (e.g. `'orders.*'`).
   * At-most-once delivery; no ack/nak semantics.
   */
  fromSubject<T>(nc: NatsConnection, subject: string, codec: BlitzCodec<T>): Source<T> {
    return new NatsSubjectSource(nc, subject, codec);
  },

  /**
   * Create a JetStream durable consumer source.
   * Replayable with ack/nak delivery guarantees.
   */
  fromStream<T>(
    js: JetStreamClient,
    stream: string,
    consumer: string,
    codec: BlitzCodec<T>,
  ): Source<T> {
    return new NatsStreamSource(js, stream, consumer, codec);
  },
};
