import { Stage } from '../Stage.ts';
import { NakError } from '../errors/NakError.ts';
import type { StageContext } from '../StageContext.ts';

/**
 * Transforms each input value `T` to output `R` by applying `fn`.
 * Supports both sync and async (Promise-returning) functions.
 *
 * Error handling:
 * - `NakError` thrown by `fn` is re-thrown as-is (fault policy handles retry/dead-letter).
 * - Any other error is wrapped in a `NakError`.
 */
export class MapOperator<T, R> extends Stage<T, R> {
  constructor(private readonly fn: (value: T) => R | Promise<R>) {
    super();
  }

  override async process(value: T, _ctx: StageContext): Promise<R> {
    try {
      return await this.fn(value);
    } catch (e) {
      if (e instanceof NakError) throw e;
      throw new NakError(`MapOperator fn threw: ${String(e)}`, { cause: e });
    }
  }
}
