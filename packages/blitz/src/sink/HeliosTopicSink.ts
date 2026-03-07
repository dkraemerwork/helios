import type { ITopic } from '@zenystx/helios-core/topic/ITopic';
import type { Sink } from './Sink.js';

class HeliosTopicSinkImpl<T> implements Sink<T> {
  readonly name: string;
  private readonly _topic: ITopic<T>;

  constructor(topic: ITopic<T>) {
    this._topic = topic;
    this.name = `helios-topic-sink:${topic.getName()}`;
  }

  async write(value: T): Promise<void> {
    await this._topic.publishAsync(value);
  }
}

/** Factory for ITopic-backed pipeline sinks (at-most-once broadcast). */
export const HeliosTopicSink = {
  /**
   * Broadcast each value to all topic subscribers via `ITopic.publishAsync()`.
   * At-most-once — not idempotent.
   */
  publish<T>(topic: ITopic<T>): Sink<T> {
    return new HeliosTopicSinkImpl(topic);
  },
};
