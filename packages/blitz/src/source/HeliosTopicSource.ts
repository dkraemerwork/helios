import type { ITopic } from '@helios/topic/ITopic';
import type { MessageListener } from '@helios/topic/MessageListener';
import { JsonCodec, type BlitzCodec } from '../codec/BlitzCodec.ts';
import type { Source, SourceMessage } from './Source.ts';

class HeliosTopicSourceImpl<T> implements Source<T> {
  readonly name: string;
  readonly codec: BlitzCodec<T>;
  private readonly _topic: ITopic<T>;

  constructor(topic: ITopic<T>) {
    this._topic = topic;
    this.name = `helios-topic-source:${topic.getName()}`;
    this.codec = JsonCodec<T>();
  }

  async *messages(): AsyncIterable<SourceMessage<T>> {
    const pending: T[] = [];
    let resolve: (() => void) | null = null;

    const listener: MessageListener<T> = (msg) => {
      pending.push(msg.getMessageObject());
      const r = resolve;
      resolve = null;
      r?.();
    };

    const regId = this._topic.addMessageListener(listener);

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
      this._topic.removeMessageListener(regId);
    }
  }
}

/** Factory for Helios ITopic streaming sources (unbounded). */
export const HeliosTopicSource = {
  /**
   * Subscribe to an ITopic and yield each published message.
   * The source is unbounded — it runs until the iterator is closed.
   * ack/nak are no-ops (ITopic is at-most-once).
   */
  fromTopic<T>(topic: ITopic<T>): Source<T> {
    return new HeliosTopicSourceImpl(topic);
  },
};
