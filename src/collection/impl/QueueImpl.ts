import { ItemEvent } from "@zenystx/helios-core/collection/ItemEvent";
import type { ItemListener } from "@zenystx/helios-core/collection/ItemListener";
import {
  LocalQueueStatsImpl,
  type LocalQueueStats,
} from "@zenystx/helios-core/collection/LocalQueueStats";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";

interface QueueEntry<E> {
  value: E;
  enqueuedAt: number;
}

/**
 * In-memory single-node IQueue implementation.
 */
export class QueueImpl<E> implements IQueue<E> {
  private readonly _entries: QueueEntry<E>[] = [];
  private readonly _listeners = new Map<string, ItemListener<E>>();
  private readonly _creationTime = Date.now();
  private _listenerCounter = 0;
  private _offerOperationCount = 0;
  private _rejectedOfferOperationCount = 0;
  private _pollOperationCount = 0;
  private _emptyPollOperationCount = 0;
  private _otherOperationCount = 0;
  private _eventOperationCount = 0;

  constructor(
    private readonly _maxSize = 0,
    private readonly _equalsItem: (a: E, b: E) => boolean = defaultEquals,
    private readonly _name = "queue",
  ) {}

  getName(): string {
    return this._name;
  }

  size(): number {
    return this._entries.length;
  }

  isEmpty(): boolean {
    return this._entries.length === 0;
  }

  offer(element: E): boolean;
  offer(element: E, _timeoutMs: number): Promise<boolean>;
  offer(element: E, timeoutMs?: number): boolean | Promise<boolean> {
    if (timeoutMs === undefined) {
      return this._offerNow(element);
    }
    return Promise.resolve(this._offerNow(element));
  }

  async put(element: E): Promise<void> {
    if (!this._offerNow(element)) {
      throw new Error("IllegalStateException: Queue is full");
    }
  }

  add(element: E): boolean {
    if (!this._offerNow(element)) {
      throw new Error("IllegalStateException: Queue is full");
    }
    return true;
  }

  poll(): E | null;
  poll(_timeoutMs: number): Promise<E | null>;
  poll(timeoutMs?: number): E | null | Promise<E | null> {
    if (timeoutMs === undefined) {
      return this._pollNow();
    }
    return Promise.resolve(this._pollNow());
  }

  async take(): Promise<E> {
    const item = this._pollNow();
    if (item === null) {
      throw new Error("NoSuchElementException: Queue is empty");
    }
    return item;
  }

  peek(): E | null {
    return this._entries[0]?.value ?? null;
  }

  async element(): Promise<E> {
    const item = this.peek();
    if (item === null) {
      throw new Error("NoSuchElementException: Queue is empty");
    }
    return item;
  }

  remove(element: E): boolean {
    this._assertElement(element);
    for (let index = 0; index < this._entries.length; index++) {
      if (this._equalsItem(this._entries[index].value, element)) {
        const [removed] = this._entries.splice(index, 1);
        this._otherOperationCount++;
        this._fireRemoved(removed.value, "local");
        return true;
      }
    }
    this._otherOperationCount++;
    return false;
  }

  contains(element: E): boolean {
    this._assertElement(element);
    this._otherOperationCount++;
    return this._entries.some((entry) =>
      this._equalsItem(entry.value, element),
    );
  }

  containsAll(elements: E[]): boolean {
    if (elements === null || elements === undefined) {
      throw new Error("NullPointerException: elements is null");
    }
    this._otherOperationCount++;
    return elements.every((element) => this.contains(element));
  }

  async remainingCapacity(): Promise<number> {
    if (this._maxSize === 0) {
      return Number.MAX_SAFE_INTEGER;
    }
    return this._maxSize - this._entries.length;
  }

  drainTo(collection: E[]): number;
  drainTo(collection: E[], maxElements: number): number;
  drainTo(collection: E[], maxElements?: number): number {
    if (collection === null || collection === undefined) {
      throw new Error("NullPointerException: collection is null");
    }
    const drainCount =
      maxElements === undefined
        ? this._entries.length
        : maxElements < 0
          ? this._entries.length
          : maxElements;
    const drained = this._entries.splice(0, drainCount);
    for (const entry of drained) {
      collection.push(entry.value);
      this._fireRemoved(entry.value, "local");
    }
    if (drained.length > 0) {
      this._otherOperationCount++;
    }
    return drained.length;
  }

  addAll(elements: E[]): boolean {
    if (elements === null || elements === undefined) {
      throw new Error("NullPointerException: elements is null");
    }
    if (elements.length === 0) {
      return false;
    }
    for (const element of elements) {
      this._assertElement(element);
    }
    if (
      this._maxSize > 0 &&
      this._entries.length + elements.length > this._maxSize
    ) {
      throw new Error("IllegalStateException: Queue capacity exceeded");
    }
    for (const element of elements) {
      this._offerNow(element);
    }
    return true;
  }

  retainAll(elements: E[]): boolean {
    if (elements === null || elements === undefined) {
      throw new Error("NullPointerException: elements is null");
    }
    let changed = false;
    for (let index = this._entries.length - 1; index >= 0; index--) {
      const entry = this._entries[index];
      const keep = elements.some(
        (element) =>
          element !== null &&
          element !== undefined &&
          this._equalsItem(entry.value, element),
      );
      if (!keep) {
        this._entries.splice(index, 1);
        this._fireRemoved(entry.value, "local");
        changed = true;
      }
    }
    if (changed) {
      this._otherOperationCount++;
    }
    return changed;
  }

  removeAll(elements: E[]): boolean {
    if (elements === null || elements === undefined) {
      throw new Error("NullPointerException: elements is null");
    }
    if (elements.length === 0) {
      return false;
    }
    let changed = false;
    for (let index = this._entries.length - 1; index >= 0; index--) {
      const entry = this._entries[index];
      const remove = elements.some(
        (element) =>
          element !== null &&
          element !== undefined &&
          this._equalsItem(entry.value, element),
      );
      if (remove) {
        this._entries.splice(index, 1);
        this._fireRemoved(entry.value, "local");
        changed = true;
      }
    }
    if (changed) {
      this._otherOperationCount++;
    }
    return changed;
  }

  clear(): void {
    if (this._entries.length === 0) {
      return;
    }
    const removed = this._entries.splice(0, this._entries.length);
    for (const entry of removed) {
      this._fireRemoved(entry.value, "local");
    }
    this._otherOperationCount++;
  }

  toArray(): E[] {
    return this._entries.map((entry) => entry.value);
  }

  iterator(): Iterator<E> & { remove(): never } {
    const snapshot = this.toArray();
    let index = 0;

    return {
      next(): IteratorResult<E> {
        if (index < snapshot.length) {
          return { value: snapshot[index++], done: false };
        }
        return { value: undefined as unknown as E, done: true };
      },
      remove(): never {
        throw new Error(
          "UnsupportedOperationException: iterator.remove() not supported",
        );
      },
    };
  }

  [Symbol.iterator](): Iterator<E> {
    return this.iterator();
  }

  addItemListener(listener: ItemListener<E>): string {
    if (listener === null || listener === undefined) {
      throw new Error("NullPointerException: listener is null");
    }
    const id = `listener-${++this._listenerCounter}`;
    this._listeners.set(id, listener);
    return id;
  }

  removeItemListener(registrationId: string): boolean {
    return this._listeners.delete(registrationId);
  }

  getLocalQueueStats(): LocalQueueStats {
    const ages = this._entries.map((entry) => Date.now() - entry.enqueuedAt);
    const totalAge = ages.reduce((sum, age) => sum + age, 0);

    return new LocalQueueStatsImpl({
      creationTime: this._creationTime,
      ownedItemCount: this._entries.length,
      backupItemCount: 0,
      minAge: ages.length === 0 ? 0 : Math.min(...ages),
      maxAge: ages.length === 0 ? 0 : Math.max(...ages),
      averageAge: ages.length === 0 ? 0 : Math.floor(totalAge / ages.length),
      offerOperationCount: this._offerOperationCount,
      rejectedOfferOperationCount: this._rejectedOfferOperationCount,
      pollOperationCount: this._pollOperationCount,
      emptyPollOperationCount: this._emptyPollOperationCount,
      otherOperationCount: this._otherOperationCount,
      eventOperationCount: this._eventOperationCount,
    });
  }

  replaceContents(items: E[]): void {
    this._entries.length = 0;
    for (const item of items) {
      this._entries.push({ value: item, enqueuedAt: Date.now() });
    }
  }

  private _offerNow(element: E): boolean {
    this._assertElement(element);
    if (this._maxSize > 0 && this._entries.length >= this._maxSize) {
      this._rejectedOfferOperationCount++;
      return false;
    }
    this._entries.push({ value: element, enqueuedAt: Date.now() });
    this._offerOperationCount++;
    this._fireAdded(element, "local");
    return true;
  }

  private _pollNow(): E | null {
    if (this._entries.length === 0) {
      this._emptyPollOperationCount++;
      return null;
    }
    const entry = this._entries.shift()!;
    this._pollOperationCount++;
    this._fireRemoved(entry.value, "local");
    return entry.value;
  }

  private _assertElement(element: E): void {
    if (element === null || element === undefined) {
      throw new Error("NullPointerException: null element");
    }
  }

  private _fireAdded(item: E, memberId: string): void {
    const event = new ItemEvent(this._name, item, "ADDED", memberId);
    for (const listener of Array.from(this._listeners.values())) {
      listener.itemAdded?.(event);
      this._eventOperationCount++;
    }
  }

  private _fireRemoved(item: E, memberId: string): void {
    const event = new ItemEvent(this._name, item, "REMOVED", memberId);
    for (const listener of Array.from(this._listeners.values())) {
      listener.itemRemoved?.(event);
      this._eventOperationCount++;
    }
  }
}

function defaultEquals<E>(a: E, b: E): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (
    typeof (a as { equals?: (other: unknown) => boolean }).equals === "function"
  ) {
    return (a as { equals(other: unknown): boolean }).equals(b);
  }
  return false;
}
