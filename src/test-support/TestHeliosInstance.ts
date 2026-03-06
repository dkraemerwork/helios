/**
 * Minimal HeliosInstance facade for unit tests and example apps.
 *
 * Exposes access to services and distributed-object instances.
 * Data structures are lazily created per name (same name = same instance).
 *
 * This class is intentionally thin — it is a test harness, not a production
 * HeliosInstance implementation (that comes in Block 3.10).
 */
import { TestNodeEngine } from "@zenystx/helios-core/test-support/TestNodeEngine";
import { MapProxy } from "@zenystx/helios-core/map/impl/MapProxy";
import { MapContainerService } from "@zenystx/helios-core/map/impl/MapContainerService";
import { QueueImpl } from "@zenystx/helios-core/collection/impl/QueueImpl";
import { ListImpl } from "@zenystx/helios-core/collection/impl/ListImpl";
import { SetImpl } from "@zenystx/helios-core/collection/impl/SetImpl";
import { TopicImpl } from "@zenystx/helios-core/topic/impl/TopicImpl";
import { MultiMapImpl } from "@zenystx/helios-core/multimap/impl/MultiMapImpl";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { IList } from "@zenystx/helios-core/collection/IList";
import type { ISet } from "@zenystx/helios-core/collection/ISet";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";

/** @deprecated Use MapProxy directly. Kept for backwards compatibility. */
export { MapProxy as SimpleMapProxy } from "@zenystx/helios-core/map/impl/MapProxy";

export class TestHeliosInstance {
  readonly nodeEngine: TestNodeEngine;
  private readonly _mapContainerService = new MapContainerService();
  private readonly maps = new Map<string, MapProxy<unknown, unknown>>();
  private readonly queues = new Map<string, QueueImpl<unknown>>();
  private readonly lists = new Map<string, ListImpl<unknown>>();
  private readonly sets = new Map<string, SetImpl<unknown>>();
  private readonly topics = new Map<string, TopicImpl<unknown>>();
  private readonly multiMaps = new Map<
    string,
    MultiMapImpl<unknown, unknown>
  >();
  private running = true;

  constructor(nodeEngine?: TestNodeEngine) {
    this.nodeEngine = nodeEngine ?? new TestNodeEngine();
    this.nodeEngine.registerService(
      "hz:impl:mapService",
      this._mapContainerService,
    );
  }

  getName(): string {
    return "test-instance";
  }

  getNodeEngine(): TestNodeEngine {
    return this.nodeEngine;
  }

  // ── Data structure accessors (lazy creation, same name = same instance) ──

  getMap<K, V>(name: string): IMap<K, V> {
    let proxy = this.maps.get(name);
    if (!proxy) {
      const store = this._mapContainerService.getOrCreateRecordStore(name, 0);
      proxy = new MapProxy<unknown, unknown>(
        name,
        store,
        this.nodeEngine,
        this._mapContainerService,
      );
      this.maps.set(name, proxy);
    }
    return proxy as IMap<K, V>;
  }

  getQueue<E>(name: string): IQueue<E> {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new QueueImpl<unknown>();
      this.queues.set(name, queue);
    }
    return queue as IQueue<E>;
  }

  getList<E>(name: string): IList<E> {
    let list = this.lists.get(name);
    if (!list) {
      list = new ListImpl<unknown>();
      this.lists.set(name, list);
    }
    return list as IList<E>;
  }

  getSet<E>(name: string): ISet<E> {
    let set = this.sets.get(name);
    if (!set) {
      set = new SetImpl<unknown>();
      this.sets.set(name, set);
    }
    return set as ISet<E>;
  }

  getTopic<E>(name: string): ITopic<E> {
    let topic = this.topics.get(name);
    if (!topic) {
      topic = new TopicImpl<unknown>(name);
      this.topics.set(name, topic);
    }
    return topic as ITopic<E>;
  }

  getReliableTopic<E>(_name: string): ITopic<E> {
    throw new Error(
      "ReliableTopic is not implemented yet; use getTopic() for classic topic semantics",
    );
  }

  getMultiMap<K, V>(name: string): MultiMap<K, V> {
    let mmap = this.multiMaps.get(name);
    if (!mmap) {
      mmap = new MultiMapImpl<unknown, unknown>();
      this.multiMaps.set(name, mmap);
    }
    return mmap as MultiMap<K, V>;
  }

  shutdown(): void {
    this.running = false;
    for (const topic of Array.from(this.topics.values())) topic.destroy();
    this.maps.clear();
    this.queues.clear();
    this.lists.clear();
    this.sets.clear();
    this.topics.clear();
    this.multiMaps.clear();
  }

  isRunning(): boolean {
    return this.running;
  }
}
