import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { OutOfMemoryErrorDispatcher } from '@helios/instance/impl/OutOfMemoryErrorDispatcher';
import { OutOfMemoryHandler } from '@helios/instance/impl/OutOfMemoryHandler';
import { DefaultOutOfMemoryHandler } from '@helios/instance/impl/DefaultOutOfMemoryHandler';
import type { HeliosInstance } from '@helios/core/HeliosInstance';

function makeInstance(): HeliosInstance {
  return { shutdown: mock(() => {}), getName: mock(() => 'mock') } as unknown as HeliosInstance;
}

describe('OutOfMemoryErrorDispatcher', () => {
  beforeEach(() => {
    OutOfMemoryErrorDispatcher.clearServers();
    OutOfMemoryErrorDispatcher.setServerHandler(new DefaultOutOfMemoryHandler());
  });

  test('onOutOfMemory', () => {
    const oome = new Error('out of memory');

    const onOutOfMemoryFn = mock((_oome: Error, _instances: HeliosInstance[]) => {});
    const shouldHandleFn = mock(() => true);
    const handler = { shouldHandle: shouldHandleFn, onOutOfMemory: onOutOfMemoryFn } as unknown as OutOfMemoryHandler;

    const hz1 = makeInstance();
    OutOfMemoryErrorDispatcher.registerServer(hz1);
    OutOfMemoryErrorDispatcher.setServerHandler(handler);

    const registeredBefore = OutOfMemoryErrorDispatcher.current();

    OutOfMemoryErrorDispatcher.onOutOfMemory(oome);

    // handler was called with the registered instances
    expect(onOutOfMemoryFn).toHaveBeenCalledTimes(1);
    expect(onOutOfMemoryFn.mock.calls[0]![0]).toBe(oome);
    expect(onOutOfMemoryFn.mock.calls[0]![1]).toEqual(registeredBefore);
    // instances are cleared after OOM
    expect(OutOfMemoryErrorDispatcher.current()).toEqual([]);
  });

  test('register', () => {
    const hz1 = makeInstance();
    const hz2 = makeInstance();

    OutOfMemoryErrorDispatcher.registerServer(hz1);
    expect(OutOfMemoryErrorDispatcher.current()).toEqual([hz1]);

    OutOfMemoryErrorDispatcher.registerServer(hz2);
    expect(OutOfMemoryErrorDispatcher.current()).toEqual([hz1, hz2]);
  });

  test('register_whenNull throws', () => {
    expect(() => OutOfMemoryErrorDispatcher.registerServer(null as unknown as HeliosInstance)).toThrow();
  });

  test('deregister_Existing', () => {
    const hz1 = makeInstance();
    const hz2 = makeInstance();
    const hz3 = makeInstance();
    OutOfMemoryErrorDispatcher.registerServer(hz1);
    OutOfMemoryErrorDispatcher.registerServer(hz2);
    OutOfMemoryErrorDispatcher.registerServer(hz3);

    OutOfMemoryErrorDispatcher.deregisterServer(hz2);
    expect(OutOfMemoryErrorDispatcher.current()).toEqual([hz1, hz3]);

    OutOfMemoryErrorDispatcher.deregisterServer(hz1);
    expect(OutOfMemoryErrorDispatcher.current()).toEqual([hz3]);

    OutOfMemoryErrorDispatcher.deregisterServer(hz3);
    expect(OutOfMemoryErrorDispatcher.current()).toEqual([]);
  });

  test('deregister_nonExisting', () => {
    const instance = makeInstance();
    // should not throw
    OutOfMemoryErrorDispatcher.deregisterServer(instance);
  });

  test('deregister_null throws', () => {
    expect(() => OutOfMemoryErrorDispatcher.deregisterServer(null as unknown as HeliosInstance)).toThrow();
  });

  test('shouldHandle_true calls handler', () => {
    const oome = new Error('oom');
    const hz = makeInstance();
    OutOfMemoryErrorDispatcher.registerServer(hz);

    const onOutOfMemoryFn = mock((_oome: Error, _instances: HeliosInstance[]) => {});
    const handler = { shouldHandle: mock(() => true), onOutOfMemory: onOutOfMemoryFn } as unknown as OutOfMemoryHandler;
    OutOfMemoryErrorDispatcher.setServerHandler(handler);

    OutOfMemoryErrorDispatcher.onOutOfMemory(oome);
    expect(onOutOfMemoryFn).toHaveBeenCalledTimes(1);
  });

  test('shouldHandle_false skips handler', () => {
    const oome = new Error('oom');
    const hz = makeInstance();
    OutOfMemoryErrorDispatcher.registerServer(hz);

    const onOutOfMemoryFn = mock((_oome: Error, _instances: HeliosInstance[]) => {});
    const handler = { shouldHandle: mock(() => false), onOutOfMemory: onOutOfMemoryFn } as unknown as OutOfMemoryHandler;
    OutOfMemoryErrorDispatcher.setServerHandler(handler);

    OutOfMemoryErrorDispatcher.onOutOfMemory(oome);
    expect(onOutOfMemoryFn).not.toHaveBeenCalled();
  });
});

describe('DefaultOutOfMemoryHandler', () => {
  test('gcOverheadLimitExceeded is always handled', () => {
    const oome = new Error(DefaultOutOfMemoryHandler.GC_OVERHEAD_LIMIT_EXCEEDED);
    const handler = new DefaultOutOfMemoryHandler();
    expect(handler.shouldHandle(oome)).toBe(true);
  });

  test('total_smaller_than_max NOT handled', () => {
    const handler = new DefaultOutOfMemoryHandler(0.1, {
      getMaxMemory: () => 100 * 1024 * 1024,
      getTotalMemory: () => 80 * 1024 * 1024,
      getFreeMemory: () => 10 * 1024 * 1024,
    });
    const oome = new Error('heap');
    expect(handler.shouldHandle(oome)).toBe(false);
  });

  test('total_equal_max with enough free NOT handled', () => {
    const handler = new DefaultOutOfMemoryHandler(0.1, {
      getMaxMemory: () => 100 * 1024 * 1024,
      getTotalMemory: () => 100 * 1024 * 1024,
      getFreeMemory: () => 20 * 1024 * 1024,
    });
    const oome = new Error('heap');
    expect(handler.shouldHandle(oome)).toBe(false);
  });

  test('total_equal_max not enough free IS handled', () => {
    const handler = new DefaultOutOfMemoryHandler(0.1, {
      getMaxMemory: () => 100 * 1024 * 1024,
      getTotalMemory: () => 100 * 1024 * 1024,
      getFreeMemory: () => 5 * 1024 * 1024,
    });
    const oome = new Error('heap');
    expect(handler.shouldHandle(oome)).toBe(true);
  });
});
