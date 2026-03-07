/**
 * Per-listener consumption loop for reliable topic.
 * Reads from the backing ringbuffer by sequence, adapting both
 * plain MessageListener and future ReliableMessageListener contracts.
 *
 * Port of com.hazelcast.topic.impl.reliable.MessageRunner.
 *
 * Block 19T.1: Supports notify-driven wakeup — when new items are appended
 * the service calls notify() which immediately triggers a poll instead of
 * waiting for the next polling interval.
 */
import type { ArrayRingbuffer } from "@zenystx/helios-core/ringbuffer/impl/ArrayRingbuffer";
import { Message } from "@zenystx/helios-core/topic/Message";
import type { MessageListener } from "@zenystx/helios-core/topic/MessageListener";
import type { ReliableTopicMessageRecord } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicMessageRecord";

export class ReliableTopicListenerRunner<T> {
  private _sequence: number;
  private _cancelled = false;
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _waiting = false;
  private readonly _topicName: string;
  private readonly _listener: MessageListener<T>;
  private readonly _ringbuffer: ArrayRingbuffer<ReliableTopicMessageRecord>;
  private readonly _batchSize: number;
  private readonly _onReceive: (() => void) | null;

  constructor(
    topicName: string,
    listener: MessageListener<T>,
    ringbuffer: ArrayRingbuffer<ReliableTopicMessageRecord>,
    initialSequence: number,
    batchSize: number,
    onReceive?: () => void,
  ) {
    this._topicName = topicName;
    this._listener = listener;
    this._ringbuffer = ringbuffer;
    this._sequence = initialSequence;
    this._batchSize = batchSize;
    this._onReceive = onReceive ?? null;
  }

  start(): void {
    this._schedulePoll();
  }

  cancel(): void {
    this._cancelled = true;
    if (this._pollTimer !== null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this._waiting = false;
  }

  isCancelled(): boolean {
    return this._cancelled;
  }

  /**
   * Called by ReliableTopicService when new items are appended to the
   * backing ringbuffer. Immediately triggers a poll if the runner is
   * currently waiting for data.
   */
  notify(): void {
    if (this._cancelled || !this._waiting) return;
    this._waiting = false;
    if (this._pollTimer !== null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    // Use queueMicrotask for immediate but non-recursive delivery
    queueMicrotask(() => this._poll());
  }

  private _schedulePoll(): void {
    if (this._cancelled) return;
    this._pollTimer = setTimeout(() => this._poll(), 10);
  }

  private _poll(): void {
    if (this._cancelled) return;

    const tail = this._ringbuffer.tailSequence();
    const head = this._ringbuffer.headSequence();

    // Stale sequence — jump to head (loss-tolerant behavior for plain listeners adapted via adapter)
    if (this._sequence < head) {
      this._sequence = head;
    }

    // Nothing to read yet — mark as waiting for notify
    if (this._sequence > tail) {
      this._waiting = true;
      this._schedulePoll();
      return;
    }

    this._waiting = false;

    // Read up to batchSize items
    let count = 0;
    while (this._sequence <= tail && count < this._batchSize && !this._cancelled) {
      try {
        const record = this._ringbuffer.read(this._sequence);
        const msg = new Message<T>(
          this._topicName,
          record.payload as T,
          record.publishTime,
          record.publisherAddress,
        );
        try {
          this._listener(msg);
        } catch {
          // Listener exception isolation: continue to next message
        }
        this._onReceive?.();
      } catch {
        // Read error — skip this sequence
      }
      this._sequence++;
      count++;
    }

    if (!this._cancelled) {
      this._schedulePoll();
    }
  }
}
