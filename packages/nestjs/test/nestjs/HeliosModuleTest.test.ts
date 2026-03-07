/**
 * Tests for HeliosModule — NestJS DynamicModule with forRoot / forRootAsync.
 * Corresponds to hazelcast-spring NestJS integration (Block 6.1).
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
import { HELIOS_INSTANCE_TOKEN } from "@zenystx/helios-nestjs/HeliosInstanceDefinition";
import { HeliosModule } from "@zenystx/helios-nestjs/HeliosModule";
import { afterEach, describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Minimal stub implementing HeliosInstance for tests
// ---------------------------------------------------------------------------

class StubHeliosInstance implements HeliosInstance {
  constructor(readonly name: string) {}
  getName(): string {
    return this.name;
  }
  shutdown(): void {}
  getMap<K, V>(_n: string): IMap<K, V> {
    return null!;
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
// forRoot tests
// ---------------------------------------------------------------------------

describe("HeliosModule.forRoot", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("provides the instance under HELIOS_INSTANCE_TOKEN", async () => {
    const instance = new StubHeliosInstance("test-node");

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(instance)],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved).toBe(instance);
  });

  it("is global — child module can inject instance without re-importing", async () => {
    @Injectable()
    class ConsumerService {
      constructor(@Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance) {}
    }

    const instance = new StubHeliosInstance("global-test");

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(instance)],
      providers: [ConsumerService],
    }).compile();

    const svc = module.get(ConsumerService);
    expect(svc.hz).toBe(instance);
  });

  it("returns a DynamicModule with module property set to HeliosModule", async () => {
    const dm = HeliosModule.forRoot(new StubHeliosInstance("x"));
    expect(dm.module).toBe(HeliosModule);
  });

  it("exports HELIOS_INSTANCE_TOKEN so consumer modules can inject it", async () => {
    const dm = HeliosModule.forRoot(new StubHeliosInstance("x"));
    expect(dm.exports).toBeDefined();
    const exports = dm.exports as unknown[];
    expect(exports).toContain(HELIOS_INSTANCE_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// forRootAsync tests
// ---------------------------------------------------------------------------

describe("HeliosModule.forRootAsync", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("useFactory: provides the instance asynchronously", async () => {
    const instance = new StubHeliosInstance("async-node");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRootAsync({
          useFactory: async () => instance,
        }),
      ],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved).toBe(instance);
  });

  it("useFactory with inject: injects dependency into factory", async () => {
    const CONFIG_TOKEN = "CONFIG_TOKEN";
    const instance = new StubHeliosInstance("injected-factory");

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRootAsync({
          inject: [CONFIG_TOKEN],
          useFactory: (config: { name: string }) =>
            new StubHeliosInstance(config.name),
          extraProviders: [
            { provide: CONFIG_TOKEN, useValue: { name: "injected-factory" } },
          ],
        }),
      ],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved.getName()).toBe("injected-factory");
  });

  it("returns a DynamicModule with module property set to HeliosModule", () => {
    const dm = HeliosModule.forRootAsync({
      useFactory: async () => new StubHeliosInstance("x"),
    });
    expect(dm.module).toBe(HeliosModule);
  });

  it("exports HELIOS_INSTANCE_TOKEN so consumer modules can inject it", () => {
    const dm = HeliosModule.forRootAsync({
      useFactory: async () => new StubHeliosInstance("x"),
    });
    const exports = dm.exports as unknown[];
    expect(exports).toContain(HELIOS_INSTANCE_TOKEN);
  });
});
