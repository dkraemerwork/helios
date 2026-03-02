import type { WriteBehindQueue } from './WriteBehindQueue.js';
import type { WriteBehindProcessor } from './WriteBehindProcessor.js';

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
      await this._processor.process(entries);
    }
  }

  private async _tick(): Promise<void> {
    if (this._running) return;
    this._running = true;
    try {
      const entries = this._queue.drainTo(Date.now());
      if (entries.length > 0) {
        await this._processor.process(entries);
      }
    } finally {
      this._running = false;
    }
  }
}
