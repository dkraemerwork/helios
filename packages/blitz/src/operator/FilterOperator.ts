import { NakError } from '../errors/NakError.js';
import { Stage } from '../Stage.js';
import type { StageContext } from '../StageContext.js';

/**
 * Passes values through only when `pred` returns `true`; drops (returns `void`) otherwise.
 * Supports both sync and async (Promise-returning) predicates.
 *
 * Error handling:
 * - `NakError` thrown by `pred` is re-thrown as-is.
 * - Any other error is wrapped in a `NakError`.
 */
export class FilterOperator<T> extends Stage<T, T> {
  constructor(private readonly pred: (value: T) => boolean | Promise<boolean>) {
    super();
  }

  override async process(value: T, _ctx: StageContext): Promise<T | undefined> {
    try {
      const pass = await this.pred(value);
      return pass ? value : undefined;
    } catch (e) {
      if (e instanceof NakError) throw e;
      throw new NakError(`FilterOperator pred threw: ${String(e)}`, { cause: e });
    }
  }
}
