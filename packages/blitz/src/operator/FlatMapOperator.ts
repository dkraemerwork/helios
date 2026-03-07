import { NakError } from '../errors/NakError.js';
import { Stage } from '../Stage.js';
import type { StageContext } from '../StageContext.js';

/**
 * Expands each input `T` into zero or more outputs `R[]`.
 * `fn` may return a plain array or an `AsyncIterable<R>` (e.g. async generator).
 *
 * Error handling:
 * - `NakError` thrown by `fn` is re-thrown as-is.
 * - Any other error is wrapped in a `NakError`.
 */
export class FlatMapOperator<T, R> extends Stage<T, R> {
  constructor(private readonly fn: (value: T) => R[] | AsyncIterable<R>) {
    super();
  }

  override async process(value: T, _ctx: StageContext): Promise<R[]> {
    try {
      const result = this.fn(value);
      if (Array.isArray(result)) return result;
      const items: R[] = [];
      for await (const item of result as AsyncIterable<R>) {
        items.push(item);
      }
      return items;
    } catch (e) {
      if (e instanceof NakError) throw e;
      throw new NakError(`FlatMapOperator fn threw: ${String(e)}`, { cause: e });
    }
  }
}
