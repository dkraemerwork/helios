import type { Sink } from './Sink.js';

class LogSinkImpl<T> implements Sink<T> {
  readonly name = 'log-sink';

  async write(value: T): Promise<void> {
    console.log('[LogSink]', value);
  }
}

/** Factory for console-logging debug sinks. */
export const LogSink = {
  /**
   * Log each value to `console.log` with a `[LogSink]` prefix.
   * For debugging and testing only — not for production pipelines.
   */
  console<T>(): Sink<T> {
    return new LogSinkImpl<T>();
  },
};
