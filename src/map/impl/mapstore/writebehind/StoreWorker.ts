import type { WriteBehindProcessor } from './WriteBehindProcessor.js';
import type { WriteBehindQueue } from './WriteBehindQueue.js';

export class StoreWorker<K, V> {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;

  constructor(
    private readonly _queue: WriteBehindQueue<K, V>,
    private readonly _processor: WriteBehindProcessor<K, V>,
  ) {}

  start(): void {
    this._timer = setInterval(() => {
      void this._tick();
    }, 1000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async flush(): Promise<void> {
    this.stop();
    const entries = this._queue.drainAll();
    if (entries.length > 0) {
      const result = await this._processor.process(entries);
      // Hard flush: log failures but do NOT re-queue them
      // (matches Hazelcast's flushInternal → printErrorLog behavior)
      if (result.failed.length > 0) {
        console.warn(
          `[WriteBehind] flush: ${result.failed.length} entries could not be stored and were dropped`,
        );
      }
    }
  }

  private async _tick(): Promise<void> {
    if (this._running) return;
    this._running = true;
    try {
      const entries = this._queue.drainTo(Date.now());
      if (entries.length > 0) {
        const result = await this._processor.process(entries);
        // Re-queue failed entries at the front for retry on next tick
        // This cycle repeats indefinitely — matching Hazelcast's
        // reAddFailedStoreOperationsToQueues() in StoreWorker.java
        if (result.failed.length > 0) {
          this._queue.addFirst(result.failed);
        }
      }
    } finally {
      this._running = false;
    }
  }
}
