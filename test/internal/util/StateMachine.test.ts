import { StateMachine } from '@zenystx/helios-core/internal/util/StateMachine';
import { beforeEach, describe, expect, it } from 'bun:test';

const enum State { A = 'A', B = 'B', C = 'C' }

describe('StateMachineTest', () => {
  let machine: StateMachine<State>;

  beforeEach(() => {
    machine = StateMachine.of<State>(State.A)
      .withTransition(State.A, State.B)
      .withTransition(State.B, State.C);
  });

  it('testIsInInitialState_whenCreated', () => {
    expect(machine.is(State.A)).toBe(true);
  });

  it('testChangesState_whenTransitionValid', () => {
    machine.next(State.B);
    expect(machine.is(State.B)).toBe(true);
    machine.next(State.C);
    expect(machine.is(State.C)).toBe(true);
  });

  it('testThrowsException_whenTransitionInvalid', () => {
    expect(() => machine.next(State.C)).toThrow();
  });

  it('testStaysAtState_whenAlreadyThere', () => {
    machine.nextOrStay(State.A);
    expect(machine.is(State.A)).toBe(true);
  });
});
