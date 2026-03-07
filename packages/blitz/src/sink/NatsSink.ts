import type { JetStreamClient } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import type { BlitzCodec } from '../codec/BlitzCodec.js';
import type { Sink } from './Sink.js';

class NatsSubjectSink<T> implements Sink<T> {
  readonly name: string;
  readonly codec: BlitzCodec<T>;
  private readonly _nc: NatsConnection;
  private readonly _subject: string;

  constructor(nc: NatsConnection, subject: string, codec: BlitzCodec<T>) {
    this._nc = nc;
    this._subject = subject;
    this.codec = codec;
    this.name = `nats-sink:${subject}`;
  }

  async write(value: T): Promise<void> {
    this._nc.publish(this._subject, this.codec.encode(value));
  }
}

class NatsStreamSink<T> implements Sink<T> {
  readonly name: string;
  readonly codec: BlitzCodec<T>;
  private readonly _js: JetStreamClient;
  private readonly _stream: string;

  constructor(js: JetStreamClient, stream: string, codec: BlitzCodec<T>) {
    this._js = js;
    this._stream = stream;
    this.codec = codec;
    this.name = `nats-stream-sink:${stream}`;
  }

  async write(value: T): Promise<void> {
    await this._js.publish(this._stream, this.codec.encode(value));
  }
}

/**
 * Factory for NATS-backed pipeline sinks.
 *
 * Note: The connection is provided at construction time for Block 10.2.
 * Block 10.3+ will inject the connection via BlitzService at submit time.
 */
export const NatsSink = {
  /**
   * Publish to a NATS core subject (at-most-once delivery).
   */
  toSubject<T>(nc: NatsConnection, subject: string, codec: BlitzCodec<T>): Sink<T> {
    return new NatsSubjectSink(nc, subject, codec);
  },

  /**
   * Publish to a JetStream stream (durable, ack-based, exactly-once safe).
   */
  toStream<T>(js: JetStreamClient, stream: string, codec: BlitzCodec<T>): Sink<T> {
    return new NatsStreamSink(js, stream, codec);
  },
};
