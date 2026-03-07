/**
 * Block 6.5 — NestJS context integration tests.
 *
 * Ports the intent of:
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/context/TestAutoWire.java
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/context/TestManagedContext.java
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/springaware/
 *     TestEnabledSpringAwareAnnotation.java
 *     TestDisabledSpringAwareAnnotation.java
 *     TestSpringAwareAnnotationWithProgrammaticConfiguration.java
 *
 * Tests NestManagedContext + NestAware + HeliosModule DI integration.
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
import { NestAware } from "@zenystx/helios-nestjs/context/NestAware";
import { NestManagedContext } from "@zenystx/helios-nestjs/context/NestManagedContext";
import { HeliosCacheModule } from "@zenystx/helios-nestjs/HeliosCacheModule";
import { HELIOS_INSTANCE_TOKEN } from "@zenystx/helios-nestjs/HeliosInstanceDefinition";
import { HeliosModule } from "@zenystx/helios-nestjs/HeliosModule";
import { afterEach, describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class StubHeliosInstance implements HeliosInstance {
  constructor(private readonly _name: string) {}
  getName(): string {
    return this._name;
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

function makeModuleRef(resolveImpl: (token: unknown) => unknown = () => null) {
  return {
    resolve: (token: unknown) => Promise.resolve(resolveImpl(token)),
    get: (token: unknown) => resolveImpl(token),
  };
}

// ---------------------------------------------------------------------------
// NestManagedContext — setModuleRef via NestJS ModuleRef
// ---------------------------------------------------------------------------

describe("NestManagedContext — ModuleRef integration (TestManagedContext.java port)", () => {
  // Java: testSerialization — spring managed context initializes beans
  it("initialize() returns the same object reference for @NestAware objects", () => {
    @NestAware()
    class SomeTask {
      dep: unknown = null;
    }

    const ctx = new NestManagedContext();
    const task = new SomeTask();
    const result = ctx.initialize(task);
    expect(result).toBe(task);
  });

  it("initialize() with ModuleRef injects via inject() call", () => {
    const TOKEN = "SOME_BEAN";
    const bean = { value: 42 };

    @NestAware()
    class SomeValue {
      someBean: typeof bean | null = null;
    }

    const moduleRef = makeModuleRef((t) => (t === TOKEN ? bean : null));
    const ctx = new NestManagedContext(moduleRef as never);

    const value = new SomeValue();
    ctx.inject(value, TOKEN, "someBean");
    expect(value.someBean).toBe(bean);
  });

  it("non-@NestAware plain object is returned unchanged from initialize()", () => {
    class PlainValue {
      data: string = "no-injection";
    }

    const ctx = new NestManagedContext();
    const v = new PlainValue();
    expect(ctx.initialize(v)).toBe(v);
    expect(v.data).toBe("no-injection");
  });

  it("inject() with missing token resolves to null and sets null on field", () => {
    @NestAware()
    class SomeBean {
      dep: unknown = "initial";
    }

    const moduleRef = makeModuleRef(() => null);
    const ctx = new NestManagedContext(moduleRef as never);
    const bean = new SomeBean();
    ctx.inject(bean, "MISSING_TOKEN", "dep");
    expect(bean.dep).toBeNull();
  });

  it("setModuleRef() can update the module reference after construction", () => {
    const TOKEN = "TOKEN_A";
    const serviceA = { name: "ServiceA" };
    const serviceB = { name: "ServiceB" };

    @NestAware()
    class Task {
      service: typeof serviceA | null = null;
    }

    const refA = makeModuleRef((t) => (t === TOKEN ? serviceA : null));
    const ctx = new NestManagedContext(refA as never);

    const task = new Task();
    ctx.inject(task, TOKEN, "service");
    expect(task.service).toBe(serviceA);

    // Now switch to different module ref
    const refB = makeModuleRef((t) => (t === TOKEN ? serviceB : null));
    ctx.setModuleRef(refB as never);

    const task2 = new Task();
    ctx.inject(task2, TOKEN, "service");
    expect(task2.service).toBe(serviceB);
  });

  // Java: multiple @NestAware fields on same object
  it("multiple inject() calls on same object each set their respective fields", () => {
    const BEAN_A = "BEAN_A";
    const BEAN_B = "BEAN_B";
    const beanA = { id: "A" };
    const beanB = { id: "B" };

    @NestAware()
    class MultiTask {
      depA: typeof beanA | null = null;
      depB: typeof beanB | null = null;
    }

    const moduleRef = makeModuleRef((t) => {
      if (t === BEAN_A) return beanA;
      if (t === BEAN_B) return beanB;
      return null;
    });
    const ctx = new NestManagedContext(moduleRef as never);

    const task = new MultiTask();
    ctx.inject(task, BEAN_A, "depA");
    ctx.inject(task, BEAN_B, "depB");

    expect(task.depA).toBe(beanA);
    expect(task.depB).toBe(beanB);
  });
});

// ---------------------------------------------------------------------------
// NestAware decorator + @Injectable service DI patterns
// ---------------------------------------------------------------------------

describe("NestAware decorator — programmatic context configuration (TestSpringAwareAnnotation ports)", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  // Java: TestEnabledSpringAwareAnnotation — @SpringAware object gets context injected
  it("@NestAware class is recognized by NestManagedContext", () => {
    @NestAware()
    class AwareTask {
      instance: HeliosInstance | null = null;
    }

    const ctx = new NestManagedContext();
    const task = new AwareTask();
    const result = ctx.initialize(task);
    // @NestAware: context processes it (returns same ref)
    expect(result).toBe(task);
  });

  // Java: TestDisabledSpringAwareAnnotation — no annotation = no injection
  it("class without @NestAware is NOT processed for injection", () => {
    class NonAwareTask {
      instance: HeliosInstance | null = null;
    }

    const hz = { name: "injected" } as unknown as HeliosInstance;
    const moduleRef = makeModuleRef(() => hz);
    const ctx = new NestManagedContext(moduleRef as never);
    const task = new NonAwareTask();

    // initialize() should return unchanged; no injection happens
    const result = ctx.initialize(task);
    expect(result).toBe(task);
    expect(task.instance).toBeNull(); // not set
  });

  // Java: TestSpringAwareAnnotationWithProgrammaticConfiguration
  it("@NestAware works with NestJS module DI: inject HeliosInstance into task", async () => {
    const hz = new StubHeliosInstance("programmatic");

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz)],
    }).compile();

    const TOKEN = HELIOS_INSTANCE_TOKEN;
    const moduleRef = {
      get: (t: unknown) => module.get(t as string),
      resolve: (t: unknown) => Promise.resolve(module.get(t as string)),
    };

    @NestAware()
    class SomeAwareTask {
      instance: HeliosInstance | null = null;
    }

    const ctx = new NestManagedContext(moduleRef as never);
    const task = new SomeAwareTask();
    ctx.inject(task, TOKEN, "instance");

    expect(task.instance).toBe(hz);
    expect(task.instance?.getName()).toBe("programmatic");
  });
});

// ---------------------------------------------------------------------------
// Full context integration: HeliosModule + NestManagedContext + cache
// ---------------------------------------------------------------------------

describe("Full context integration — HeliosModule + NestManagedContext + HeliosCacheModule", () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) await module.close();
  });

  it("HeliosModule + HeliosCacheModule: context can access both instance and cache", async () => {
    @Injectable()
    class AppService {
      constructor(
        @Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance,
        @Inject(CACHE_MANAGER) readonly cache: Cache,
      ) {}

      async work(key: string, value: string): Promise<string | undefined> {
        await this.cache.set(key, value);
        return this.cache.get<string>(key);
      }
    }

    const hz = new StubHeliosInstance("context-full");

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz), HeliosCacheModule.register()],
      providers: [AppService],
    }).compile();

    const svc = module.get(AppService);
    const result = await svc.work("item", "hello");
    expect(svc.hz.getName()).toBe("context-full");
    expect(result).toBe("hello");
  });

  it("DynamicModule from HeliosModule + child service work together end-to-end", async () => {
    @Injectable()
    class GreetingService {
      constructor(@Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance) {}

      greet(): string {
        return `Hello from ${this.hz.getName()}`;
      }
    }

    @Module({
      providers: [GreetingService],
      exports: [GreetingService],
    })
    class GreetingModule {}

    const hz = new StubHeliosInstance("helios-node-1");

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz), GreetingModule],
    }).compile();

    const svc = module.get(GreetingService);
    expect(svc.greet()).toBe("Hello from helios-node-1");
  });

  it("NestManagedContext initialized via module get can access providers", async () => {
    @Injectable()
    class MyService {
      value = "from-service";
    }

    const hz = new StubHeliosInstance("managed-ctx");
    const MY_SERVICE_TOKEN = "MY_SERVICE";

    module = await Test.createTestingModule({
      imports: [HeliosModule.forRoot(hz)],
      providers: [{ provide: MY_SERVICE_TOKEN, useClass: MyService }],
    }).compile();

    const moduleRef = {
      get: (t: unknown) => module.get(t as string),
      resolve: (t: unknown) => Promise.resolve(module.get(t as string)),
    };

    @NestAware()
    class TaskWithService {
      svc: MyService | null = null;
    }

    const ctx = new NestManagedContext(moduleRef as never);
    const task = new TaskWithService();
    ctx.inject(task, MY_SERVICE_TOKEN, "svc");

    expect(task.svc).toBeInstanceOf(MyService);
    expect(task.svc?.value).toBe("from-service");
  });
});
