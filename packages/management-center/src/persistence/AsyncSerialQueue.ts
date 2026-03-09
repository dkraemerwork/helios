/**
 * Serializes all database write operations to prevent SQLITE_BUSY errors.
 *
 * Every write to the SQLite database—whether from schedulers, repositories, or
 * the write batcher—must be funnelled through this queue. Operations execute
 * strictly one at a time in FIFO order. Failures in one operation reject only
 * that operation's promise; subsequent enqueued work proceeds normally.
 */

import { Injectable, Logger } from '@nestjs/common';

interface QueueEntry<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

@Injectable()
export class AsyncSerialQueue {
  private readonly logger = new Logger(AsyncSerialQueue.name);
  private readonly queue: QueueEntry<unknown>[] = [];
  private running = false;
  private _depth = 0;

  /** Current number of operations waiting in the queue (for self-metrics). */
  get depth(): number {
    return this._depth;
  }

  /**
   * Enqueues a write operation and returns a promise that resolves with its
   * result once the operation completes. The operation will execute after all
   * previously enqueued operations finish.
   */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject } as QueueEntry<unknown>);
      this._depth++;
      this.drain();
    });
  }

  /** Drains the queue by executing operations one at a time. */
  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this._depth--;

      try {
        const result = await entry.fn();
        entry.resolve(result);
      } catch (err) {
        this.logger.warn(`Queued write operation failed: ${err instanceof Error ? err.message : String(err)}`);
        entry.reject(err);
      }
    }

    this.running = false;
  }
}
