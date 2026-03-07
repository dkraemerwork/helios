import { HeliosLifecycleService } from '@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService';
import { LifecycleState } from '@zenystx/helios-core/instance/lifecycle/LifecycleEvent';
import type { LifecycleListener } from '@zenystx/helios-core/instance/lifecycle/LifecycleListener';
import { describe, expect, test } from 'bun:test';

describe('HeliosLifecycleService', () => {
  test('isRunning starts true, false after shutdown', () => {
    const svc = new HeliosLifecycleService();
    expect(svc.isRunning()).toBe(true);
    svc.shutdown();
    expect(svc.isRunning()).toBe(false);
  });

  test('addLifecycleListener returns unique IDs', () => {
    const svc = new HeliosLifecycleService();
    const l1: LifecycleListener = { stateChanged: () => {} };
    const l2: LifecycleListener = { stateChanged: () => {} };
    const id1 = svc.addLifecycleListener(l1);
    const id2 = svc.addLifecycleListener(l2);
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
  });

  test('removeLifecycleListener existing returns true', () => {
    const svc = new HeliosLifecycleService();
    const l: LifecycleListener = { stateChanged: () => {} };
    const id = svc.addLifecycleListener(l);
    expect(svc.removeLifecycleListener(id)).toBe(true);
  });

  test('removeLifecycleListener non-existing returns false', () => {
    const svc = new HeliosLifecycleService();
    expect(svc.removeLifecycleListener('non-existent-id')).toBe(false);
  });

  test('fireLifecycleEvent calls all listeners', () => {
    const svc = new HeliosLifecycleService();
    const events1: LifecycleState[] = [];
    const events2: LifecycleState[] = [];
    svc.addLifecycleListener({ stateChanged: (e) => events1.push(e.getState()) });
    svc.addLifecycleListener({ stateChanged: (e) => events2.push(e.getState()) });

    svc.fireLifecycleEvent(LifecycleState.STARTING);
    expect(events1).toEqual([LifecycleState.STARTING]);
    expect(events2).toEqual([LifecycleState.STARTING]);
  });

  test('removed listener is not called', () => {
    const svc = new HeliosLifecycleService();
    const events: LifecycleState[] = [];
    const l: LifecycleListener = { stateChanged: (e) => events.push(e.getState()) };
    const id = svc.addLifecycleListener(l);
    svc.removeLifecycleListener(id);
    svc.fireLifecycleEvent(LifecycleState.STARTED);
    expect(events).toEqual([]);
  });

  test('shutdown fires SHUTTING_DOWN then SHUTDOWN', () => {
    const svc = new HeliosLifecycleService();
    const events: LifecycleState[] = [];
    svc.addLifecycleListener({ stateChanged: (e) => events.push(e.getState()) });
    svc.shutdown();
    expect(events).toEqual([LifecycleState.SHUTTING_DOWN, LifecycleState.SHUTDOWN]);
  });

  test('terminate fires SHUTTING_DOWN then SHUTDOWN', () => {
    const svc = new HeliosLifecycleService();
    const events: LifecycleState[] = [];
    svc.addLifecycleListener({ stateChanged: (e) => events.push(e.getState()) });
    svc.terminate();
    expect(events).toEqual([LifecycleState.SHUTTING_DOWN, LifecycleState.SHUTDOWN]);
  });

  test('addLifecycleListener null throws', () => {
    const svc = new HeliosLifecycleService();
    expect(() => svc.addLifecycleListener(null as unknown as LifecycleListener)).toThrow();
  });

  test('multiple listeners receive all events', () => {
    const svc = new HeliosLifecycleService();
    const callCounts = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const idx = i;
      svc.addLifecycleListener({ stateChanged: () => { callCounts[idx]!++; } });
    }
    svc.fireLifecycleEvent(LifecycleState.STARTED);
    expect(callCounts).toEqual([1, 1, 1]);
  });
});
