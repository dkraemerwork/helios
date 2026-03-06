/**
 * Block 6.5 — HeliosObjectExtractionModule tests.
 *
 * Ports the intent of:
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/java/
 *     AllDistributedObjectsAreIncludedTest.java
 *     ExcludeByNameTest.java / ExcludeByTypeTest.java
 *     IncludeByNameTest.java / IncludeByTypeTest.java
 *     FullContextTest.java
 *
 * Tests the HeliosObjectExtractionModule that exposes distributed objects
 * (IMap, etc.) as injectable NestJS providers.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { Inject, Injectable } from "@nestjs/common";
import { HeliosModule } from "@zenystx/nestjs/HeliosModule";
import { HeliosObjectExtractionModule } from "@zenystx/nestjs/HeliosObjectExtractionModule";
import { HELIOS_INSTANCE_TOKEN } from "@zenystx/nestjs/HeliosInstanceDefinition";
import type { HeliosInstance } from "@zenystx/core/core/HeliosInstance";
import type { IMap } from "@zenystx/core/map/IMap";
import type { IQueue } from "@zenystx/core/collection/IQueue";
import type { IList } from "@zenystx/core/collection/IList";
import type { ISet } from "@zenystx/core/collection/ISet";
import type { ITopic } from "@zenystx/core/topic/ITopic";
import type { MultiMap } from "@zenystx/core/multimap/MultiMap";
import type { ReplicatedMap } from "@zenystx/core/replicatedmap/ReplicatedMap";
import type { DistributedObject } from "@zenystx/core/core/DistributedObject";
import type { LifecycleService } from "@zenystx/core/instance/lifecycle/LifecycleService";
import type { Cluster } from "@zenystx/core/cluster/Cluster";
import type { HeliosConfig } from "@zenystx/core/config/HeliosConfig";
import type { IExecutorService } from "@zenystx/core/executor/IExecutorService";

// ---------------------------------------------------------------------------
// Stub HeliosInstance with named map support
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

// ---------------------------------------------------------------------------
// forRoot() static method tests
// ---------------------------------------------------------------------------

describe("HeliosObjectExtractionModule.forRoot() — module metadata", () => {
  it("returns a DynamicModule with module property set to HeliosObjectExtractionModule", () => {
    const dm = HeliosObjectExtractionModule.forRoot({});
    expect(dm.module).toBe(HeliosObjectExtractionModule);
  });

  it("forRoot() with no options produces no providers", () => {
    const dm = HeliosObjectExtractionModule.forRoot();
    expect(dm.providers?.length ?? 0).toBe(0);
  });

  it("forRoot() with empty maps produces no providers", () => {
    const dm = HeliosObjectExtractionModule.forRoot({ maps: {} });
    expect(dm.providers?.length ?? 0).toBe(0);
  });

  it("forRoot() with one map entry produces one provider", () => {
    const dm = HeliosObjectExtractionModule.forRoot({
      maps: { MAP_TOKEN: "myMap" },
    });
    expect(dm.providers?.length).toBe(1);
  });

  it("forRoot() exports all registered tokens", () => {
    const dm = HeliosObjectExtractionModule.forRoot({
      maps: { MAP_A: "mapA", MAP_B: "mapB" },
    });
    const exports = dm.exports as string[];
    expect(exports).toContain("MAP_A");
    expect(exports).toContain("MAP_B");
  });
});

// ---------------------------------------------------------------------------
// NestJS DI integration tests
// ---------------------------------------------------------------------------

describe("HeliosObjectExtractionModule — NestJS DI integration", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("registered map token resolves the IMap from HeliosInstance", async () => {
    const MAP_TOKEN = "MY_MAP";
    const instance = new StubHeliosInstance("di-test-node");
    instance.addMap("myMap");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({
          maps: { [MAP_TOKEN]: "myMap" },
        }),
      ],
    }).compile();

    const map = module.get<StubMap<string, string>>(MAP_TOKEN);
    expect(map).toBeDefined();
    expect(map.name).toBe("myMap");
  });

  it("multiple maps are each resolvable by their individual tokens", async () => {
    const instance = new StubHeliosInstance("multi-map");
    instance.addMap("orders");
    instance.addMap("products");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({
          maps: { ORDERS: "orders", PRODUCTS: "products" },
        }),
      ],
    }).compile();

    const orders = module.get<StubMap<string, unknown>>("ORDERS");
    const products = module.get<StubMap<string, unknown>>("PRODUCTS");
    expect(orders.name).toBe("orders");
    expect(products.name).toBe("products");
  });

  it("@Injectable service can inject extracted map via token", async () => {
    const ORDER_MAP_TOKEN = "ORDER_MAP";
    const instance = new StubHeliosInstance("service-test");
    instance.addMap("orderMap");

    @Injectable()
    class OrderService {
      constructor(
        @Inject(ORDER_MAP_TOKEN)
        private readonly orderMap: StubMap<string, string>,
      ) {}

      saveOrder(id: string, data: string): void {
        this.orderMap.set(id, data);
      }

      getOrder(id: string): string | undefined {
        return this.orderMap.get(id);
      }
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({
          maps: { [ORDER_MAP_TOKEN]: "orderMap" },
        }),
      ],
      providers: [OrderService],
    }).compile();

    const svc = module.get(OrderService);
    svc.saveOrder("order-1", "item-data");
    expect(svc.getOrder("order-1")).toBe("item-data");
  });

  it("extracted map can be operated on (put + get)", async () => {
    const MAP_TOKEN = "DATA_MAP";
    const instance = new StubHeliosInstance("ops-test");
    instance.addMap("dataMap");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({
          maps: { [MAP_TOKEN]: "dataMap" },
        }),
      ],
    }).compile();

    const map = module.get<StubMap<string, string>>(MAP_TOKEN);
    map.set("key1", "value1");
    expect(map.get("key1")).toBe("value1");
    expect(map.get("nonexistent")).toBeUndefined();
  });

  it("HeliosModule is also accessible when HeliosObjectExtractionModule is imported", async () => {
    const instance = new StubHeliosInstance("combined-test");
    instance.addMap("testMap");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(instance),
        HeliosObjectExtractionModule.forRoot({ maps: { TEST_MAP: "testMap" } }),
      ],
    }).compile();

    const hz = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(hz.getName()).toBe("combined-test");
  });

  it("map token resolves even when HeliosInstance is created asynchronously", async () => {
    const instance = new StubHeliosInstance("async-test");
    instance.addMap("asyncMap");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRootAsync({ useFactory: async () => instance }),
        HeliosObjectExtractionModule.forRoot({
          maps: { ASYNC_MAP: "asyncMap" },
        }),
      ],
    }).compile();

    const map = module.get<StubMap<string, string>>("ASYNC_MAP");
    expect(map).toBeDefined();
    expect(map.name).toBe("asyncMap");
  });
});
