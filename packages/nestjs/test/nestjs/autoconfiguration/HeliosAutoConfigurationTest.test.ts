/**
 * Block 6.4 — Boot 4 Autoconfiguration tests.
 *
 * Ports the intent of:
 *   hazelcast-spring-boot4/src/test/java/com/hazelcast/spring/boot4/
 *     AllDistributedObjectsAreIncludedTest.java
 *     BootConfiguredContextTest.java
 *     ExcludeByNameTest.java
 *     ExcludeByTypeTest.java
 *     IncludeByNameTest.java
 *     IncludeByTypeTest.java
 *     FullContextTest.java
 *
 * All infrastructure-only tests (ArchUnit, NOTICE file) are dropped.
 */

import { Inject, Injectable } from "@nestjs/common";
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
import { HeliosAutoConfigurationModule } from "@zenystx/helios-nestjs/autoconfiguration/HeliosAutoConfigurationModule";
import { HeliosBoot4ObjectExtractionModule } from "@zenystx/helios-nestjs/autoconfiguration/HeliosBoot4ObjectExtractionModule";
import { HELIOS_INSTANCE_TOKEN } from "@zenystx/helios-nestjs/HeliosInstanceDefinition";
import { afterEach, describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Stub HeliosInstance with named map/ringbuffer support
// ---------------------------------------------------------------------------

interface StubMap<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  readonly name: string;
}

interface StubRingbuffer {
  readonly name: string;
  capacity(): number;
}

class StubHeliosInstance implements HeliosInstance {
  private readonly maps: Map<string, StubMap<unknown, unknown>> = new Map();
  private readonly ringbuffers: Map<string, StubRingbuffer> = new Map();

  constructor(private readonly instanceName: string) {}

  getName(): string {
    return this.instanceName;
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

  addRingbuffer(name: string): void {
    this.ringbuffers.set(name, { name, capacity: () => 10 });
  }

  getMap<K, V>(name: string): IMap<K, V> {
    return this.maps.get(name) as unknown as IMap<K, V>;
  }

  getRingbuffer(name: string): StubRingbuffer | undefined {
    return this.ringbuffers.get(name);
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
// Helper factory: creates a StubHeliosInstance with map1, testMap, ringbuffer
// ---------------------------------------------------------------------------

function createFullInstance(): StubHeliosInstance {
  const inst = new StubHeliosInstance("test-node");
  inst.addMap("map1");
  inst.addMap("testMap");
  inst.addRingbuffer("ringbuffer");
  return inst;
}

// ---------------------------------------------------------------------------
// 1–4: HeliosAutoConfigurationModule tests
// ---------------------------------------------------------------------------

describe("HeliosAutoConfigurationModule.forRoot", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("provides HeliosInstance under HELIOS_INSTANCE_TOKEN", async () => {
    const instance = new StubHeliosInstance("auto-node");

    module = await Test.createTestingModule({
      imports: [HeliosAutoConfigurationModule.forRoot(instance)],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved).toBe(instance);
  });

  it("is global — consumer can inject instance without re-importing", async () => {
    @Injectable()
    class Consumer {
      constructor(@Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance) {}
    }

    const instance = new StubHeliosInstance("global-auto");

    module = await Test.createTestingModule({
      imports: [HeliosAutoConfigurationModule.forRoot(instance)],
      providers: [Consumer],
    }).compile();

    const svc = module.get(Consumer);
    expect(svc.hz.getName()).toBe("global-auto");
  });

  it("exports HELIOS_INSTANCE_TOKEN", () => {
    const dm = HeliosAutoConfigurationModule.forRoot(
      new StubHeliosInstance("x"),
    );
    const exports = dm.exports as unknown[];
    expect(exports).toContain(HELIOS_INSTANCE_TOKEN);
  });
});

describe("HeliosAutoConfigurationModule.forRootAsync", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("provides HeliosInstance via async factory", async () => {
    const instance = new StubHeliosInstance("async-auto");

    module = await Test.createTestingModule({
      imports: [
        HeliosAutoConfigurationModule.forRootAsync({
          useFactory: async () => instance,
        }),
      ],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved).toBe(instance);
  });
});

// ---------------------------------------------------------------------------
// 5–11: HeliosBoot4ObjectExtractionModule tests
// ---------------------------------------------------------------------------

describe("HeliosBoot4ObjectExtractionModule", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  const MAP1_TOKEN = "map1";
  const TEST_MAP_TOKEN = "testMap";
  const RINGBUFFER_TOKEN = "ringbuffer";

  const allObjects = [
    { token: MAP1_TOKEN, name: "map1", type: "IMap" as const },
    { token: TEST_MAP_TOKEN, name: "testMap", type: "IMap" as const },
    {
      token: RINGBUFFER_TOKEN,
      name: "ringbuffer",
      type: "Ringbuffer" as const,
    },
  ];

  it("all objects are registered when no filter is set (AllDistributedObjectsAreIncluded)", async () => {
    const instance = createFullInstance();

    module = await Test.createTestingModule({
      imports: [
        HeliosAutoConfigurationModule.forRoot(instance),
        HeliosBoot4ObjectExtractionModule.forRoot({ objects: allObjects }),
      ],
    }).compile();

    expect(module.get(MAP1_TOKEN)).toBeDefined();
    expect(module.get(TEST_MAP_TOKEN)).toBeDefined();
    expect(module.get(RINGBUFFER_TOKEN)).toBeDefined();
  });

  it("excludeByName: the excluded map is not registered", async () => {
    const instance = createFullInstance();

    module = await Test.createTestingModule({
      imports: [
        HeliosAutoConfigurationModule.forRoot(instance),
        HeliosBoot4ObjectExtractionModule.forRoot({
          objects: allObjects,
          excludeByName: "map1",
        }),
      ],
    }).compile();

    expect(() => module.get(MAP1_TOKEN)).toThrow();
    expect(module.get(TEST_MAP_TOKEN)).toBeDefined();
  });

  it("excludeByName: non-excluded objects remain accessible", async () => {
    const instance = createFullInstance();

    module = await Test.createTestingModule({
      imports: [
        HeliosAutoConfigurationModule.forRoot(instance),
        HeliosBoot4ObjectExtractionModule.forRoot({
          objects: allObjects,
          excludeByName: "map1",
        }),
      ],
    }).compile();

    const testMap = module.get<StubMap<unknown, unknown>>(TEST_MAP_TOKEN);
    expect(testMap).toBeDefined();
    expect(testMap.name).toBe("testMap");
  });

  it("excludeByType: all objects of excluded type are not registered", async () => {
    const instance = createFullInstance();

    module = await Test.createTestingModule({
      imports: [
        HeliosAutoConfigurationModule.forRoot(instance),
        HeliosBoot4ObjectExtractionModule.forRoot({
          objects: allObjects,
          excludeByType: ["IMap"],
        }),
      ],
    }).compile();

    expect(() => module.get(MAP1_TOKEN)).toThrow();
    expect(() => module.get(TEST_MAP_TOKEN)).toThrow();
    expect(module.get(RINGBUFFER_TOKEN)).toBeDefined();
  });

  it("includeByName: only specified names are registered", async () => {
    const instance = createFullInstance();

    module = await Test.createTestingModule({
      imports: [
        HeliosAutoConfigurationModule.forRoot(instance),
        HeliosBoot4ObjectExtractionModule.forRoot({
          objects: allObjects,
          includeByName: ["testMap"],
        }),
      ],
    }).compile();

    expect(() => module.get(MAP1_TOKEN)).toThrow();
    expect(module.get(TEST_MAP_TOKEN)).toBeDefined();
    expect(() => module.get(RINGBUFFER_TOKEN)).toThrow();
  });

  it("includeByType: only objects of specified type are registered", async () => {
    const instance = createFullInstance();

    module = await Test.createTestingModule({
      imports: [
        HeliosAutoConfigurationModule.forRoot(instance),
        HeliosBoot4ObjectExtractionModule.forRoot({
          objects: allObjects,
          includeByType: ["IMap"],
        }),
      ],
    }).compile();

    expect(module.get(MAP1_TOKEN)).toBeDefined();
    expect(module.get(TEST_MAP_TOKEN)).toBeDefined();
    expect(() => module.get(RINGBUFFER_TOKEN)).toThrow();
  });

  it("full context: HeliosAutoConfigurationModule + HeliosBoot4ObjectExtractionModule work together", async () => {
    const instance = createFullInstance();
    const MAP_TOKEN = "map1";

    module = await Test.createTestingModule({
      imports: [
        HeliosAutoConfigurationModule.forRoot(instance),
        HeliosBoot4ObjectExtractionModule.forRoot({
          objects: [{ token: MAP_TOKEN, name: "map1", type: "IMap" }],
        }),
      ],
    }).compile();

    const hz = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(hz.getName()).toBe("test-node");

    const map = module.get<StubMap<string, string>>(MAP_TOKEN);
    expect(map).toBeDefined();
    map.set("key1", "value1");
    expect(map.get("key1")).toBe("value1");
  });
});
