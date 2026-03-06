/**
 * Tests for Block 9.1 — ConfigurableModuleBuilder pattern for HeliosModule.
 * Verifies forRootAsync with useClass, useExisting, and useFactory patterns.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { Inject, Injectable, Module } from "@nestjs/common";
import {
  HeliosModule,
  HeliosInstanceFactory,
} from "@zenystx/helios-nestjs/HeliosModule";
import { HELIOS_INSTANCE_TOKEN } from "@zenystx/helios-nestjs/HeliosInstanceDefinition";
import type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { IList } from "@zenystx/helios-core/collection/IList";
import type { ISet } from "@zenystx/helios-core/collection/ISet";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";
import type { ReplicatedMap } from "@zenystx/helios-core/replicatedmap/ReplicatedMap";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import type { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { IExecutorService } from "@zenystx/helios-core/executor/IExecutorService";

// ---------------------------------------------------------------------------
// Stub HeliosInstance
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
// useClass tests
// ---------------------------------------------------------------------------

describe("HeliosModule.forRootAsync — useClass", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("useClass: instantiates factory class and calls createHeliosInstance()", async () => {
    @Injectable()
    class MyHeliosFactory implements HeliosInstanceFactory {
      createHeliosInstance(): HeliosInstance {
        return new StubHeliosInstance("from-class");
      }
    }

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRootAsync({ useClass: MyHeliosFactory })],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved.getName()).toBe("from-class");
  });

  it("useClass: factory class can receive injected dependencies via @Inject()", async () => {
    const NAME_TOKEN = "INSTANCE_NAME";

    @Injectable()
    class ConfigurableFactory implements HeliosInstanceFactory {
      constructor(@Inject(NAME_TOKEN) private readonly instanceName: string) {}
      createHeliosInstance(): HeliosInstance {
        return new StubHeliosInstance(this.instanceName);
      }
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRootAsync({
          useClass: ConfigurableFactory,
          extraProviders: [{ provide: NAME_TOKEN, useValue: "injected-name" }],
        }),
      ],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved.getName()).toBe("injected-name");
  });

  it("useClass: supports async createHeliosInstance()", async () => {
    @Injectable()
    class AsyncFactory implements HeliosInstanceFactory {
      async createHeliosInstance(): Promise<HeliosInstance> {
        await Promise.resolve(); // simulate async work
        return new StubHeliosInstance("async-class");
      }
    }

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRootAsync({ useClass: AsyncFactory })],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved.getName()).toBe("async-class");
  });

  it("useClass: DynamicModule has module set to HeliosModule", () => {
    @Injectable()
    class DummyFactory implements HeliosInstanceFactory {
      createHeliosInstance(): HeliosInstance {
        return null!;
      }
    }
    const dm = HeliosModule.forRootAsync({ useClass: DummyFactory });
    expect(dm.module).toBe(HeliosModule);
  });

  it("useClass: DynamicModule exports HELIOS_INSTANCE_TOKEN", () => {
    @Injectable()
    class DummyFactory implements HeliosInstanceFactory {
      createHeliosInstance(): HeliosInstance {
        return null!;
      }
    }
    const dm = HeliosModule.forRootAsync({ useClass: DummyFactory });
    const exports = dm.exports as unknown[];
    expect(exports).toContain(HELIOS_INSTANCE_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// useExisting tests
// ---------------------------------------------------------------------------

describe("HeliosModule.forRootAsync — useExisting", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("useExisting: reuses an already-registered factory provider by string token", async () => {
    const EXISTING_FACTORY_TOKEN = "EXISTING_HELIOS_FACTORY";

    @Injectable()
    class SharedHeliosFactory implements HeliosInstanceFactory {
      createHeliosInstance(): HeliosInstance {
        return new StubHeliosInstance("existing-factory");
      }
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRootAsync({
          useExisting: EXISTING_FACTORY_TOKEN,
          extraProviders: [
            { provide: EXISTING_FACTORY_TOKEN, useClass: SharedHeliosFactory },
          ],
        }),
      ],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved.getName()).toBe("existing-factory");
  });

  it("useExisting: reuses a class token directly", async () => {
    @Injectable()
    class DirectClassFactory implements HeliosInstanceFactory {
      createHeliosInstance(): HeliosInstance {
        return new StubHeliosInstance("direct-class-token");
      }
    }

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRootAsync({
          useExisting: DirectClassFactory,
          extraProviders: [
            { provide: DirectClassFactory, useClass: DirectClassFactory },
          ],
        }),
      ],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved.getName()).toBe("direct-class-token");
  });

  it("useExisting: DynamicModule has module set to HeliosModule", () => {
    const dm = HeliosModule.forRootAsync({ useExisting: "SOME_FACTORY" });
    expect(dm.module).toBe(HeliosModule);
  });

  it("useExisting: DynamicModule exports HELIOS_INSTANCE_TOKEN", () => {
    const dm = HeliosModule.forRootAsync({ useExisting: "SOME_FACTORY" });
    const exports = dm.exports as unknown[];
    expect(exports).toContain(HELIOS_INSTANCE_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// imports field (useFactory + imports)
// ---------------------------------------------------------------------------

describe("HeliosModule.forRootAsync — imports field", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("imports: modules imported in forRootAsync provide deps to factory", async () => {
    // A simple "ConfigModule" that provides a config value
    const CONFIG_SERVICE_TOKEN = "CONFIG_SERVICE";

    @Injectable()
    class ConfigService {
      getInstanceName(): string {
        return "from-imports";
      }
    }

    @Module({
      providers: [{ provide: CONFIG_SERVICE_TOKEN, useClass: ConfigService }],
      exports: [CONFIG_SERVICE_TOKEN],
    })
    class ConfigModule {}

    module = await Test.createTestingModule({
      imports: [
        HeliosModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (config: ConfigService) =>
            new StubHeliosInstance(config.getInstanceName()),
          inject: [CONFIG_SERVICE_TOKEN],
        }),
      ],
    }).compile();

    const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
    expect(resolved.getName()).toBe("from-imports");
  });
});
