/**
 * Block 6.5 — Full NestJS module integration tests.
 *
 * Ports the intent of:
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/context/TestAutoWire.java
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/context/LiteMemberTest.java
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/TestBeansApplicationContext.java
 *
 * Tests full module composition: HeliosModule + HeliosCacheModule +
 * HeliosTransactionModule + HeliosObjectExtractionModule working together.
 */

import type { Cache } from "@nestjs/cache-manager";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable, Module } from "@nestjs/common";
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
import type {
  TransactionContext,
  TransactionalMap,
} from "@zenystx/helios-core/transaction/TransactionContext";
import { HeliosCacheModule } from "@zenystx/helios-nestjs/HeliosCacheModule";
import { HELIOS_INSTANCE_TOKEN } from "@zenystx/helios-nestjs/HeliosInstanceDefinition";
import { HeliosModule } from "@zenystx/helios-nestjs/HeliosModule";
import { HeliosObjectExtractionModule } from "@zenystx/helios-nestjs/HeliosObjectExtractionModule";
import type { TransactionContextFactory } from "@zenystx/helios-nestjs/HeliosTransactionManager";
import { HeliosTransactionManager } from "@zenystx/helios-nestjs/HeliosTransactionManager";
import { HeliosTransactionModule } from "@zenystx/helios-nestjs/HeliosTransactionModule";
import { ManagedTransactionalTaskContext } from "@zenystx/helios-nestjs/ManagedTransactionalTaskContext";
import { afterEach, describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface StubMap<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  readonly name: string;
}

class StubHeliosInstance implements HeliosInstance {
  private readonly maps: Map<string, StubMap<unknown, unknown>> = new Map();
  constructor(private readonly _name: string) {}
  getName(): string {
    return this._name;
  }
  shutdown(): void {}

  addMap(name: string): void {
    const data = new Map<unknown, unknown>();
    this.maps.set(name, {
      name,
      get: (k) => data.get(k),
      set: (k, v) => {
        data.set(k, v);
      },
    });
  }
  getMap<K, V>(name: string): IMap<K, V> {
    return this.maps.get(name) as unknown as IMap<K, V>;
  }
  getQueue<E>(_n: string): IQueue<E> {
    return null!;
  }
  getList<E>(_n: string): IList<E> {
    return null!;
  }
  getSet<E>(_n: string): ISet<E> {
    return null!;
  }
  getTopic<E>(_n: string): ITopic<E> {
    return null!;
  }
  getReliableTopic<E>(_n: string): ITopic<E> {
    return null!;
  }
  getMultiMap<K, V>(_n: string): MultiMap<K, V> {
    return null!;
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

function makeMockTxContext(): TransactionContext & {
  store: Map<unknown, unknown>;
  commitCount: number;
  rollbackCount: number;
} {
  const store = new Map<unknown, unknown>();
  const ctx = {
    store,
    commitCount: 0,
    rollbackCount: 0,
    beginTransaction() {},
    commitTransaction() {
      ctx.commitCount++;
    },
    rollbackTransaction() {
      ctx.rollbackCount++;
    },
    getMap<K, V>(_name: string): TransactionalMap<K, V> {
      const s = store as Map<K, V>;
      return {
        put: (k, v) => {
          const prev = s.get(k);
          s.set(k, v);
          return prev;
        },
        get: (k) => s.get(k),
        size: () => s.size,
      };
    },
  };
  return ctx;
}

function makeTxFactory(
  ctx: ReturnType<typeof makeMockTxContext>,
): TransactionContextFactory {
  return { create: () => ctx };
}

// ---------------------------------------------------------------------------
// 1. TestAutoWire equivalent — HeliosModule provides injectable instance
// ---------------------------------------------------------------------------

describe("HeliosModule — autowire equivalent (TestAutoWire.java port)", () => {
  let module: TestingModule;

  afterEach(async () => {
    HeliosTransactionManager.setCurrent(null);
    if (module) await module.close();
  });

  // Java: smoke() — bean can be @Autowired with HazelcastInstance
  it("smoke: HeliosInstance is injectable via HELIOS_INSTANCE_TOKEN", async () => {
    @Injectable()
    class SomeBean {
      constructor(
        @Inject(HELIOS_INSTANCE_TOKEN) readonly instance: HeliosInstance,
      ) {}
    }

    const hz = new StubHeliosInstance("smoke-test");
    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz)],
      providers: [SomeBean],
    }).compile();

    const bean = module.get(SomeBean);
    expect(bean.instance).toBeDefined();
    expect(bean.instance.getName()).toBe("smoke-test");
  });

  // Multiple beans can all inject the same HeliosInstance
  it("multiple @Injectable services can inject the same HeliosInstance", async () => {
    @Injectable()
    class ServiceA {
      constructor(@Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance) {}
    }

    @Injectable()
    class ServiceB {
      constructor(@Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance) {}
    }

    const hz = new StubHeliosInstance("multi-inject");
    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz)],
      providers: [ServiceA, ServiceB],
    }).compile();

    const a = module.get(ServiceA);
    const b = module.get(ServiceB);
    expect(a.hz).toBe(hz);
    expect(b.hz).toBe(hz);
    expect(a.hz).toBe(b.hz);
  });
});

// ---------------------------------------------------------------------------
// 2. HeliosModule + HeliosCacheModule combination
// ---------------------------------------------------------------------------

describe("HeliosModule + HeliosCacheModule — full integration", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("HeliosInstance and CACHE_MANAGER are both injectable in the same module", async () => {
    const hz = new StubHeliosInstance("cache-combo");

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz), HeliosCacheModule.register()],
    }).compile();

    const instance = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    const cacheManager = module.get<Cache>(CACHE_MANAGER);

    expect(instance.getName()).toBe("cache-combo");
    expect(cacheManager).toBeDefined();
  });

  it("service can inject both HeliosInstance and CACHE_MANAGER", async () => {
    @Injectable()
    class DualService {
      constructor(
        @Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance,
        @Inject(CACHE_MANAGER) readonly cache: Cache,
      ) {}
    }

    const hz = new StubHeliosInstance("dual-inject");

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz), HeliosCacheModule.register()],
      providers: [DualService],
    }).compile();

    const svc = module.get(DualService);
    expect(svc.hz).toBe(hz);
    expect(svc.cache).toBeDefined();

    // Both work correctly
    await svc.cache.set("test-key", "test-value");
    expect(await svc.cache.get<string>("test-key")).toBe("test-value");
  });
});

// ---------------------------------------------------------------------------
// 3. HeliosModule + HeliosObjectExtractionModule + HeliosCacheModule
// ---------------------------------------------------------------------------

describe("HeliosModule + HeliosObjectExtractionModule + HeliosCacheModule — full context", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  // Java: FullContextTest.testMap()
  it("extracted IMap and CACHE_MANAGER work independently in full context", async () => {
    const MAP_TOKEN = "ORDER_MAP";
    const hz = new StubHeliosInstance("full-context");
    hz.addMap("orders");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(hz),
        HeliosObjectExtractionModule.forRoot({
          maps: { [MAP_TOKEN]: "orders" },
        }),
        HeliosCacheModule.register(),
      ],
    }).compile();

    const map = module.get<StubMap<string, string>>(MAP_TOKEN);
    const cache = module.get<Cache>(CACHE_MANAGER);

    map.set("key1", "value1");
    expect(map.get("key1")).toBe("value1");

    await cache.set("cache-key", "cache-value");
    expect(await cache.get<string>("cache-key")).toBe("cache-value");
  });

  it("forRootAsync combined with object extraction and cache all work", async () => {
    const hz = new StubHeliosInstance("async-full");
    hz.addMap("asyncMap");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRootAsync({ useFactory: async () => hz }),
        HeliosObjectExtractionModule.forRoot({
          maps: { ASYNC_MAP: "asyncMap" },
        }),
        HeliosCacheModule.register(),
      ],
    }).compile();

    const map = module.get<StubMap<string, string>>("ASYNC_MAP");
    const cache = module.get<Cache>(CACHE_MANAGER);
    const instance = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);

    expect(instance.getName()).toBe("async-full");
    expect(map.name).toBe("asyncMap");
    expect(cache).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. HeliosModule + HeliosTransactionModule combination
// ---------------------------------------------------------------------------

describe("HeliosModule + HeliosTransactionModule — combined", () => {
  let module: TestingModule;

  afterEach(async () => {
    HeliosTransactionManager.setCurrent(null);
    if (module) await module.close();
  });

  it("HeliosInstance and HeliosTransactionManager are both injectable", async () => {
    const hz = new StubHeliosInstance("tx-combo");
    const ctx = makeMockTxContext();

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(hz),
        HeliosTransactionModule.register(makeTxFactory(ctx)),
      ],
    }).compile();

    const instance = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    const txMgr = module.get(HeliosTransactionManager);

    expect(instance.getName()).toBe("tx-combo");
    expect(txMgr).toBeInstanceOf(HeliosTransactionManager);
  });

  it("transaction manager can commit when combined with HeliosModule", async () => {
    const hz = new StubHeliosInstance("tx-commit");
    const ctx = makeMockTxContext();

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(hz),
        HeliosTransactionModule.register(makeTxFactory(ctx)),
      ],
    }).compile();

    const txMgr = module.get(HeliosTransactionManager);
    await txMgr.run(() => {
      ctx.getMap("orders").put("order-1", "item");
    });

    expect(ctx.commitCount).toBe(1);
    expect(ctx.store.get("order-1")).toBe("item");
  });

  it("service can inject both HeliosInstance and ManagedTransactionalTaskContext", async () => {
    @Injectable()
    class OrderService {
      constructor(
        @Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance,
        readonly taskContext: ManagedTransactionalTaskContext,
      ) {}
    }

    const hz = new StubHeliosInstance("order-service");
    const ctx = makeMockTxContext();

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(hz),
        HeliosTransactionModule.register(makeTxFactory(ctx)),
      ],
      providers: [OrderService],
    }).compile();

    const svc = module.get(OrderService);
    expect(svc.hz.getName()).toBe("order-service");
    expect(svc.taskContext).toBeInstanceOf(ManagedTransactionalTaskContext);
  });
});

// ---------------------------------------------------------------------------
// 5. Child module / feature module pattern
// ---------------------------------------------------------------------------

describe("HeliosModule — child module (NestJS feature module pattern)", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("HeliosModule.forRoot is global — child modules can inject without re-importing", async () => {
    @Injectable()
    class ChildService {
      constructor(@Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance) {}
    }

    @Module({ providers: [ChildService], exports: [ChildService] })
    class ChildModule {}

    const hz = new StubHeliosInstance("global-test");

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz), ChildModule],
    }).compile();

    const svc = module.get(ChildService);
    expect(svc.hz.getName()).toBe("global-test");
  });
});
