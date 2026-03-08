/**
 * Bounded async channel with backpressure.
 *
 * Senders block when the channel is full; receivers block when it is empty.
 * Closing the channel unblocks all waiters and rejects future operations
 * (but buffered items can still be drained).
 */
export class AsyncChannel<T> {
  private readonly buffer: T[] = [];
  private readonly _capacity: number;
  private _closed = false;

  /** Waiters blocked on send (channel full). */
  private readonly sendWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  /** Waiters blocked on receive (channel empty). */
  private readonly recvWaiters: Array<{ resolve: (value: T) => void; reject: (err: Error) => void }> = [];

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error(`capacity must be positive, got ${capacity}`);
    }
    this._capacity = capacity;
  }

  get capacity(): number {
    return this._capacity;
  }

  get size(): number {
    return this.buffer.length;
  }

  get isFull(): boolean {
    return this.buffer.length >= this._capacity;
  }

  get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Send an item into the channel. Blocks (returns a pending promise) when the
   * channel is at capacity until a receiver drains an item.
   */
  async send(item: T): Promise<void> {
    if (this._closed) {
      throw new Error('AsyncChannel is closed');
    }

    // If a receiver is already waiting, hand off directly
    if (this.recvWaiters.length > 0) {
      const waiter = this.recvWaiters.shift()!;
      waiter.resolve(item);
      return;
    }

    // If there's room, buffer it
    if (this.buffer.length < this._capacity) {
      this.buffer.push(item);
      return;
    }

    // Channel is full — block the sender
    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject };
      this.sendWaiters.push(entry);

      // When unblocked, push the item
      const origResolve = entry.resolve;
      entry.resolve = () => {
        if (this._closed) {
          reject(new Error('AsyncChannel is closed'));
          return;
        }
        this.buffer.push(item);
        origResolve();
      };
    });
  }

  /**
   * Receive an item from the channel. Blocks when the channel is empty.
   * If the channel is closed and non-empty, drains remaining items first.
   */
  async receive(): Promise<T> {
    // If there are buffered items, return one and unblock a waiting sender
    if (this.buffer.length > 0) {
      const item = this.buffer.shift()!;
      this.unblockOneSender();
      return item;
    }

    // Empty and closed
    if (this._closed) {
      throw new Error('AsyncChannel is closed');
    }

    // Empty — block the receiver
    return new Promise<T>((resolve, reject) => {
      this.recvWaiters.push({ resolve, reject });
    });
  }

  /**
   * Non-blocking receive. Returns undefined if empty.
   */
  tryReceive(): T | undefined {
    if (this.buffer.length === 0) {
      return undefined;
    }
    const item = this.buffer.shift()!;
    this.unblockOneSender();
    return item;
  }

  /**
   * Close the channel. Buffered items can still be drained via receive/tryReceive.
   * All blocked senders and receivers on an empty channel are rejected.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;

    const err = new Error('AsyncChannel is closed');

    // Reject all blocked senders
    for (const waiter of this.sendWaiters) {
      waiter.reject(err);
    }
    this.sendWaiters.length = 0;

    // Reject all blocked receivers (only if buffer is empty — otherwise they'll drain)
    for (const waiter of this.recvWaiters) {
      waiter.reject(err);
    }
    this.recvWaiters.length = 0;
  }

  /**
   * Async iterator that yields items until the channel is closed and drained.
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    while (true) {
      try {
        yield await this.receive();
      } catch {
        // Channel closed — stop iteration
        return;
      }
    }
  }

  private unblockOneSender(): void {
    if (this.sendWaiters.length > 0) {
      const waiter = this.sendWaiters.shift()!;
      waiter.resolve();
    }
  }
}
