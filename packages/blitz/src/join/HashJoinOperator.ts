import { Stage } from '../Stage.ts';
import type { StageContext } from '../StageContext.ts';
import { NakError } from '../errors/NakError.ts';

/**
 * Enriches each event T with data from a side-input lookup (stream-table join).
 *
 * Left-outer join semantics: if the lookup returns null or undefined for an
 * event's key, the merge function receives null as the side input. The merge
 * function decides how to handle missing entries (e.g., default values or pass-through).
 *
 * Example:
 * ```typescript
 * const op = new HashJoinOperator(
 *   order => order.productId,
 *   key => productMap.get(key),  // IMap.get() or any async lookup
 *   (order, details) => ({ ...order, category: details?.category ?? 'unknown' }),
 * );
 * ```
 */
export class HashJoinOperator<T, K, S, R> extends Stage<T, R> {
    constructor(
        /** Extract the join key from an incoming event. */
        private readonly keyFn: (event: T) => K | Promise<K>,
        /** Look up the side input by key. Returns null/undefined if not found. */
        private readonly lookup: (key: K) => S | null | undefined | Promise<S | null | undefined>,
        /** Merge the event with its side input (null when not found). */
        private readonly mergeFn: (event: T, sideInput: S | null) => R | Promise<R>,
    ) {
        super();
    }

    override async process(value: T, _ctx: StageContext): Promise<R> {
        try {
            const key = await this.keyFn(value);
            const sideInputRaw = await this.lookup(key);
            const sideInput = sideInputRaw ?? null;
            return await this.mergeFn(value, sideInput);
        } catch (e) {
            if (e instanceof NakError) throw e;
            throw new NakError(`HashJoinOperator threw: ${String(e)}`, { cause: e });
        }
    }
}
