/**
 * Block 9.2 — @InjectHelios / @InjectMap / @InjectQueue / @InjectTopic convenience
 * decorator tests.
 *
 * Tests the token-helper functions and the parameter decorators that wrap NestJS
 * Inject() with pre-computed tokens, plus the HeliosObjectExtractionModule integration
 * using named-object auto-registration.
 */

import { Injectable } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import type { IList } from "@zenystx/helios-core/collection/IList";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { ISet } from "@zenystx/helios-core/collection/ISet";
import type { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
import type { IExecutorService } from "@zenystx/helios-core/executor/IExecutorService";
import type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";
import type { ReplicatedMap } from "@zenystx/helios-core/replicatedmap/ReplicatedMap";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import { HELIOS_INSTANCE_TOKEN } from "@zenystx/helios-nestjs/HeliosInstanceDefinition";
import { HeliosModule } from "@zenystx/helios-nestjs/HeliosModule";
import { HeliosObjectExtractionModule } from "@zenystx/helios-nestjs/HeliosObjectExtractionModule";
import {
  InjectHelios,
  InjectList,
  InjectMap,
  InjectMultiMap,
  InjectQueue,
  InjectSet,
  InjectTopic,
  getListToken,
  getMapToken,
  getMultiMapToken,
  getQueueToken,
  getReplicatedMapToken,
  getSetToken,
  getTopicToken,
} from "@zenystx/helios-nestjs/decorators";
import { afterEach, describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

class StubHeliosInstance implements HeliosInstance {
  private readonly _maps = new Map<string, Map<unknown, unknown>>();
  private readonly _queues = new Map<string, unknown[]>();
  private readonly _topics = new Map<string, { name: string }>();
  private readonly _lists = new Map<string, unknown[]>();
  private readonly _sets = new Map<string, Set<unknown>>();
  private readonly _multimaps = new Map<string, Map<unknown, unknown[]>>();

  constructor(private readonly _name: string) {}
  getName(): string {
    return this._name;
  }
  shutdown(): void {}

  getMap<K, V>(name: string): IMap<K, V> {
    if (!this._maps.has(name)) this._maps.set(name, new Map());
    const m = this._maps.get(name)!;
    return {
      name,
      get: (k: K) => m.get(k) as V,
      set: (k: K, v: V) => {
        m.set(k, v);
      },
    } as unknown as IMap<K, V>;
  }
  getQueue<E>(name: string): IQueue<E> {
    if (!this._queues.has(name)) this._queues.set(name, []);
    const q = this._queues.get(name)!;
    return {
      name,
      add: (e: E) => {
        q.push(e);
      },
      peek: () => q[0] as E,
    } as unknown as IQueue<E>;
  }
  getTopic<E>(name: string): ITopic<E> {
    if (!this._topics.has(name)) this._topics.set(name, { name });
    return this._topics.get(name) as unknown as ITopic<E>;
  }
  getReliableTopic<E>(name: string): ITopic<E> {
    return this.getTopic(name);
  }
  getList<E>(name: string): IList<E> {
    if (!this._lists.has(name)) this._lists.set(name, []);
    const l = this._lists.get(name)!;
    return {
      name,
      add: (e: E) => {
        l.push(e);
      },
      size: () => l.length,
    } as unknown as IList<E>;
  }
  getSet<E>(name: string): ISet<E> {
    if (!this._sets.has(name)) this._sets.set(name, new Set());
    const s = this._sets.get(name)!;
    return {
      name,
      add: (e: E) => {
        s.add(e);
      },
      has: (e: E) => s.has(e),
    } as unknown as ISet<E>;
  }
  getMultiMap<K, V>(name: string): MultiMap<K, V> {
    if (!this._multimaps.has(name)) this._multimaps.set(name, new Map());
    return { name } as unknown as MultiMap<K, V>;
  }
  getReplicatedMap<K, V>(_n: string): ReplicatedMap<K, V> {
    return null!;
  }
  getDistributedObject(_s: string, _n: string): DistributedObject {
    return null!;
  }
  getLifecycleService(): LifecycleService {
    return null!;
  }
  getCluster(): Cluster {
    return null!;
  }
  getConfig(): HeliosConfig {
    return null!;
  }
  getExecutorService(_n: string): IExecutorService {
    return null!;
  }
}

// ---------------------------------------------------------------------------
// Token helper function tests
// ---------------------------------------------------------------------------

describe("Token helper functions", () => {
  it("getMapToken returns prefixed token", () => {
    expect(getMapToken("users")).toBe("HELIOS_MAP_users");
  });

  it("getQueueToken returns prefixed token", () => {
    expect(getQueueToken("tasks")).toBe("HELIOS_QUEUE_tasks");
  });

  it("getTopicToken returns prefixed token", () => {
    expect(getTopicToken("events")).toBe("HELIOS_TOPIC_events");
  });

  it("getListToken returns prefixed token", () => {
    expect(getListToken("items")).toBe("HELIOS_LIST_items");
  });

  it("getSetToken returns prefixed token", () => {
    expect(getSetToken("tags")).toBe("HELIOS_SET_tags");
  });

  it("getMultiMapToken returns prefixed token", () => {
    expect(getMultiMapToken("relations")).toBe("HELIOS_MULTIMAP_relations");
  });

  it("getReplicatedMapToken returns prefixed token", () => {
    expect(getReplicatedMapToken("config")).toBe(
      "HELIOS_REPLICATED_MAP_config",
    );
  });

  it("different names produce different tokens", () => {
    expect(getMapToken("a")).not.toBe(getMapToken("b"));
    expect(getQueueToken("x")).not.toBe(getQueueToken("y"));
  });
});

// ---------------------------------------------------------------------------
// @InjectHelios() — NestJS DI
// ---------------------------------------------------------------------------

describe("@InjectHelios() decorator", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("@InjectHelios() resolves the HeliosInstance from DI", async () => {
    const instance = new StubHeliosInstance("inject-helios-test");

    @Injectable()
    class MyService {
      constructor(@InjectHelios() readonly hz: HeliosInstance) {}
    }

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(instance)],
      providers: [MyService],
    }).compile();

    const svc = module.get(MyService);
    expect(svc.hz).toBe(instance);
    expect(svc.hz.getName()).toBe("inject-helios-test");
  });

  it("@InjectHelios() token equals HELIOS_INSTANCE_TOKEN", () => {
    // The decorator must use the canonical HELIOS_INSTANCE_TOKEN (a Symbol).
    // Verify it is a Symbol with the correct description.
    expect(typeof HELIOS_INSTANCE_TOKEN).toBe("symbol");
    expect(HELIOS_INSTANCE_TOKEN.description).toBe("HELIOS_INSTANCE");
  });
});

// ---------------------------------------------------------------------------
// @InjectMap / @InjectQueue / @InjectTopic / @InjectList / @InjectSet / @InjectMultiMap
// — via HeliosObjectExtractionModule namedMaps / namedQueues / etc.
// ---------------------------------------------------------------------------

describe("@InjectMap() decorator — DI integration", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("@InjectMap(name) resolves an IMap via HeliosObjectExtractionModule", async () => {
    const instance = new StubHeliosInstance("map-inject-test");

    @Injectable()
    class UserService {
      constructor(@InjectMap("users") readonly users: IMap<string, string>) {}
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({ namedMaps: ["users"] }),
      ],
      providers: [UserService],
    }).compile();

    const svc = module.get(UserService);
    expect(svc.users).toBeDefined();
    expect((svc.users as unknown as { name: string }).name).toBe("users");
  });

  it("@InjectQueue(name) resolves an IQueue via HeliosObjectExtractionModule", async () => {
    const instance = new StubHeliosInstance("queue-inject-test");

    @Injectable()
    class TaskService {
      constructor(@InjectQueue("tasks") readonly tasks: IQueue<string>) {}
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({ namedQueues: ["tasks"] }),
      ],
      providers: [TaskService],
    }).compile();

    const svc = module.get(TaskService);
    expect(svc.tasks).toBeDefined();
  });

  it("@InjectTopic(name) resolves an ITopic via HeliosObjectExtractionModule", async () => {
    const instance = new StubHeliosInstance("topic-inject-test");

    @Injectable()
    class EventBus {
      constructor(@InjectTopic("events") readonly events: ITopic<string>) {}
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({ namedTopics: ["events"] }),
      ],
      providers: [EventBus],
    }).compile();

    const svc = module.get(EventBus);
    expect(svc.events).toBeDefined();
    expect((svc.events as unknown as { name: string }).name).toBe("events");
  });

  it("@InjectList(name) resolves an IList via HeliosObjectExtractionModule", async () => {
    const instance = new StubHeliosInstance("list-inject-test");

    @Injectable()
    class ListService {
      constructor(@InjectList("items") readonly items: IList<string>) {}
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({ namedLists: ["items"] }),
      ],
      providers: [ListService],
    }).compile();

    const svc = module.get(ListService);
    expect(svc.items).toBeDefined();
  });

  it("@InjectSet(name) resolves an ISet via HeliosObjectExtractionModule", async () => {
    const instance = new StubHeliosInstance("set-inject-test");

    @Injectable()
    class TagService {
      constructor(@InjectSet("tags") readonly tags: ISet<string>) {}
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({ namedSets: ["tags"] }),
      ],
      providers: [TagService],
    }).compile();

    const svc = module.get(TagService);
    expect(svc.tags).toBeDefined();
  });

  it("@InjectMultiMap(name) resolves a MultiMap via HeliosObjectExtractionModule", async () => {
    const instance = new StubHeliosInstance("multimap-inject-test");

    @Injectable()
    class RelationService {
      constructor(
        @InjectMultiMap("relations")
        readonly relations: MultiMap<string, string>,
      ) {}
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({ namedMultiMaps: ["relations"] }),
      ],
      providers: [RelationService],
    }).compile();

    const svc = module.get(RelationService);
    expect(svc.relations).toBeDefined();
  });

  it("mixed inject decorators all resolve in a single service", async () => {
    const instance = new StubHeliosInstance("mixed-inject-test");

    @Injectable()
    class AppService {
      constructor(
        @InjectHelios() readonly hz: HeliosInstance,
        @InjectMap("profiles") readonly profiles: IMap<string, string>,
        @InjectQueue("jobs") readonly jobs: IQueue<string>,
      ) {}
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({
          namedMaps: ["profiles"],
          namedQueues: ["jobs"],
        }),
      ],
      providers: [AppService],
    }).compile();

    const svc = module.get(AppService);
    expect(svc.hz.getName()).toBe("mixed-inject-test");
    expect(svc.profiles).toBeDefined();
    expect(svc.jobs).toBeDefined();
  });
});
