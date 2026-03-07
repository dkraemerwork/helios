import { NakError } from '../errors/NakError.js';
import { Stage } from '../Stage.js';
import type { StageContext } from '../StageContext.js';

/**
 * Calls a side-effect function `fn` for observation (debug, metrics, logging)
 * then re-emits the value unchanged.
 * Supports both sync and async (Promise-returning) functions.
 *
 * Error handling:
 * - `NakError` thrown by `fn` is re-thrown as-is.
 * - Any other error is wrapped in a `NakError`.
 */
export class PeekOperator<T> extends Stage<T, T> {
  constructor(private readonly fn: (value: T) => void | Promise<void>) {
    super();
  }

  override async process(value: T, _ctx: StageContext): Promise<T> {
    try {
      await this.fn(value);
      return value;
    } catch (e) {
      if (e instanceof NakError) throw e;
      throw new NakError(`PeekOperator fn threw: ${String(e)}`, { cause: e });
    }
  }
}
