import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";
import type { ItemListener } from "@zenystx/helios-core/collection/ItemListener";
import type { LocalQueueStats } from "@zenystx/helios-core/collection/LocalQueueStats";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import { DistributedQueueService } from "@zenystx/helios-core/collection/impl/queue/DistributedQueueService";

export class QueueProxyImpl<E> implements IQueue<E> {
  constructor(
    private readonly _name: string,
    private readonly _service: DistributedQueueService,
    private readonly _serializationService: SerializationService,
  ) {}

  getName(): string {
    return this._name;
  }

  offer(element: E): Promise<boolean>;
  offer(element: E, timeoutMs: number): Promise<boolean>;
  offer(element: E, timeoutMs = 0): Promise<boolean> {
    return this._service.offer(this._name, this._toData(element), timeoutMs);
  }

  async put(element: E): Promise<void> {
    await this.offer(element, -1);
  }

  poll(): Promise<E | null>;
  poll(timeoutMs: number): Promise<E | null>;
  async poll(timeoutMs = 0): Promise<E | null> {
    const data = await this._service.poll(this._name, timeoutMs);
    return data === null ? null : this._toObject<E>(data);
  }

  async take(): Promise<E> {
    const item = await this.poll(-1);
    if (item === null) {
      throw new Error("NoSuchElementException: Queue is empty");
    }
    return item;
  }

  async peek(): Promise<E | null> {
    const data = await this._service.peek(this._name);
    return data === null ? null : this._toObject<E>(data);
  }

  async element(): Promise<E> {
    const item = await this.peek();
    if (item === null) {
      throw new Error("NoSuchElementException: Queue is empty");
    }
    return item;
  }

  async add(element: E): Promise<boolean> {
    const accepted = await this.offer(element, 0);
    if (!accepted) {
      throw new Error("IllegalStateException: Queue is full");
    }
    return true;
  }

  remove(element: E): Promise<boolean> {
    return this._service.remove(this._name, this._toData(element));
  }

  contains(element: E): Promise<boolean> {
    return this._service.contains(this._name, this._toData(element));
  }

  containsAll(elements: E[]): Promise<boolean> {
    return this._service.containsAll(
      this._name,
      elements.map((element) => this._toData(element)),
    );
  }

  size(): Promise<number> {
    return this._service.size(this._name);
  }

  isEmpty(): Promise<boolean> {
    return this._service.isEmpty(this._name);
  }

  remainingCapacity(): Promise<number> {
    return this._service.remainingCapacity(this._name);
  }

  addAll(elements: E[]): Promise<boolean> {
    return this._service.addAll(
      this._name,
      elements.map((element) => this._toData(element)),
    );
  }

  removeAll(elements: E[]): Promise<boolean> {
    return this._service.removeAll(
      this._name,
      elements.map((element) => this._toData(element)),
    );
  }

  retainAll(elements: E[]): Promise<boolean> {
    return this._service.retainAll(
      this._name,
      elements.map((element) => this._toData(element)),
    );
  }

  clear(): Promise<void> {
    return this._service.clear(this._name);
  }

  async toArray(): Promise<E[]> {
    const values = await this._service.toArray(this._name);
    return values.map((entry) => this._toObject<E>(entry));
  }

  async iterator(): Promise<Iterator<E> & { remove(): never }> {
    const snapshot = await this.toArray();
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

  addItemListener(listener: ItemListener<E>, includeValue = true): string {
    return this._service.addItemListener(this._name, listener, includeValue);
  }

  removeItemListener(registrationId: string): boolean {
    return this._service.removeItemListener(this._name, registrationId);
  }

  getLocalQueueStats(): LocalQueueStats {
    return this._service.getLocalQueueStats(this._name);
  }

  async drainTo(collection: E[]): Promise<number>;
  async drainTo(collection: E[], maxElements: number): Promise<number>;
  async drainTo(collection: E[], maxElements = -1): Promise<number> {
    const drained = await this._service.drain(this._name, maxElements);
    for (const entry of drained) {
      collection.push(this._toObject<E>(entry));
    }
    return drained.length;
  }

  private _toData(value: unknown): Data {
    const data = this._serializationService.toData(value);
    if (data === null) {
      throw new Error("NullPointerException: null element");
    }
    return data;
  }

  private _toObject<T>(data: Data): T {
    return this._serializationService.toObject<T>(data) as T;
  }
}
