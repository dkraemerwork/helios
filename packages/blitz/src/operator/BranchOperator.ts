import { FilterOperator } from './FilterOperator.ts';

/**
 * Fan-out operator: routes each message to exactly one of two branches
 * based on a predicate.
 *
 * - `trueBranch`  — receives messages for which `pred` returns `true`
 * - `falseBranch` — receives messages for which `pred` returns `false`
 *
 * Each branch is a `FilterOperator` that can be connected to downstream
 * pipeline stages independently.
 *
 * Supports both sync and async (Promise-returning) predicates.
 *
 * @example
 * ```ts
 * const { trueBranch, falseBranch } = new BranchOperator<number>(n => n > 0);
 * // trueBranch.process(5, ctx)  → 5
 * // falseBranch.process(-1, ctx) → -1
 * ```
 */
export class BranchOperator<T> {
  readonly trueBranch: FilterOperator<T>;
  readonly falseBranch: FilterOperator<T>;

  constructor(pred: (value: T) => boolean | Promise<boolean>) {
    this.trueBranch = new FilterOperator<T>(async (v) => await pred(v));
    this.falseBranch = new FilterOperator<T>(async (v) => !(await pred(v)));
  }
}
