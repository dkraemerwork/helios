import { LifecycleEvent, LifecycleState } from '@zenystx/helios-core/instance/lifecycle/LifecycleEvent';
import { describe, expect, test } from 'bun:test';

describe('LifecycleEvent', () => {
  test('getState returns the state', () => {
    const event = new LifecycleEvent(LifecycleState.STARTED);
    expect(event.getState()).toBe(LifecycleState.STARTED);
  });

  test('all lifecycle states exist', () => {
    const states = [
      LifecycleState.STARTING,
      LifecycleState.STARTED,
      LifecycleState.SHUTTING_DOWN,
      LifecycleState.SHUTDOWN,
      LifecycleState.MERGING,
      LifecycleState.MERGED,
      LifecycleState.MERGE_FAILED,
      LifecycleState.CLIENT_CONNECTED,
      LifecycleState.CLIENT_DISCONNECTED,
      LifecycleState.CLIENT_CHANGED_CLUSTER,
    ];
    for (const state of states) {
      expect(new LifecycleEvent(state).getState()).toBe(state);
    }
  });

  test('equals same state', () => {
    const e1 = new LifecycleEvent(LifecycleState.STARTED);
    const e2 = new LifecycleEvent(LifecycleState.STARTED);
    expect(e1.equals(e2)).toBe(true);
  });

  test('equals different state', () => {
    const e1 = new LifecycleEvent(LifecycleState.STARTED);
    const e2 = new LifecycleEvent(LifecycleState.SHUTDOWN);
    expect(e1.equals(e2)).toBe(false);
  });

  test('toString contains state name', () => {
    const event = new LifecycleEvent(LifecycleState.STARTED);
    expect(event.toString()).toContain('STARTED');
  });
});
