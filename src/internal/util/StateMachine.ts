import { Preconditions } from '@zenystx/core/internal/util/Preconditions';

/**
 * Simple state machine using string enum values as states.
 * Port of Java StateMachine<T extends Enum<T>>.
 */
export class StateMachine<T extends string> {
  private readonly transitions = new Map<T, Set<T>>();
  private currentState: T;

  constructor(initialState: T) {
    this.currentState = initialState;
  }

  static of<T extends string>(initialState: T): StateMachine<T> {
    return new StateMachine(initialState);
  }

  withTransition(from: T, to: T, ...moreTo: T[]): StateMachine<T> {
    let set = this.transitions.get(from);
    if (!set) { set = new Set<T>(); this.transitions.set(from, set); }
    set.add(to);
    for (const t of moreTo) set.add(t);
    return this;
  }

  next(nextState: T): StateMachine<T> {
    const allowed = this.transitions.get(this.currentState);
    Preconditions.checkNotNull(allowed ?? null, `No transitions from state ${this.currentState}`);
    Preconditions.checkState(
      allowed!.has(nextState),
      `Transition not allowed from state ${this.currentState} to ${nextState}`
    );
    this.currentState = nextState;
    return this;
  }

  nextOrStay(nextState: T): void {
    if (!this.is(nextState)) {
      this.next(nextState);
    }
  }

  is(state: T, ...otherStates: T[]): boolean {
    if (this.currentState === state) return true;
    for (const s of otherStates) {
      if (this.currentState === s) return true;
    }
    return false;
  }

  toString(): string {
    return `StateMachine{state=${this.currentState}}`;
  }
}
