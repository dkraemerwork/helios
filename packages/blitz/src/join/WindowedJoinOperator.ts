import { NakError } from '../errors/NakError.js';
import { Stage } from '../Stage.js';
import type { StageContext } from '../StageContext.js';
import type { WindowPolicy } from '../window/WindowPolicy.js';
import type { WindowState } from '../window/WindowState.js';

/** Tagged event from the left stream. */
export type LeftEvent<L> = { readonly side: 'left'; readonly value: L };
/** Tagged event from the right stream. */
export type RightEvent<R> = { readonly side: 'right'; readonly value: R };
/** Union of left/right tagged events used as input to WindowedJoinOperator. */
export type JoinEvent<L, R> = LeftEvent<L> | RightEvent<R>;

export interface WindowedJoinOptions<L, R> {
    /** Window assignment policy (tumbling, sliding, session). */
    policy: WindowPolicy;
    /** Persistent state store for buffered events (InMemoryWindowState for tests). */
    state: WindowState<JoinEvent<L, R>[]>;
    /** Join predicate — returns true when a left/right pair should be matched. */
    predicate: (left: L, right: R) => boolean;
    /**
     * Close the window after accumulating this many total events (left + right).
     * Useful for unit tests. In production use `closeWindow()` from a timer.
     */
    countTrigger?: number;
    /**
     * Extract event time from a tagged event. Defaults to Date.now().
     * Override for deterministic tests: `eventTimeExtractor: () => fixedTimestamp`.
     */
    eventTimeExtractor?: (event: JoinEvent<L, R>) => number;
    /** Called when a window closes with the matched pairs before merge is applied. */
    onEmit?: (key: string, pairs: [L, R][]) => void | Promise<void>;
}

/**
 * WindowedJoinOperator buffers events from two logical streams (left/right) per
 * window and, when the window closes, cross-joins left × right events filtered by
 * a predicate. Emits merged output for each matched pair.
 *
 * Input events MUST be tagged with `{ side: 'left' | 'right', value: ... }`.
 * Use the static helpers `WindowedJoinOperator.left()` and `.right()` to tag events.
 *
 * Example:
 * ```typescript
 * const op = new WindowedJoinOperator<Click, Purchase, JoinedEvent>(
 *   { policy, state, predicate: (c, p) => c.userId === p.userId },
 *   (click, purchase) => ({ click, purchase }),
 * );
 *
 * await op.process(WindowedJoinOperator.left(clickEvent), ctx);
 * await op.process(WindowedJoinOperator.right(purchaseEvent), ctx);
 * const results = await op.closeWindow(windowKey);
 * ```
 */
export class WindowedJoinOperator<L, R, O> extends Stage<JoinEvent<L, R>, O[]> {
    constructor(
        private readonly opts: WindowedJoinOptions<L, R>,
        private readonly mergeFn: (left: L, right: R) => O,
    ) {
        super();
    }

    /** Tag a left-stream event for input to this operator. */
    static left<L>(value: L): JoinEvent<L, never> {
        return { side: 'left', value };
    }

    /** Tag a right-stream event for input to this operator. */
    static right<R>(value: R): JoinEvent<never, R> {
        return { side: 'right', value };
    }

    override async process(
        value: JoinEvent<L, R>,
        _ctx: StageContext,
    ): Promise<O[] | void> {
        try {
            const eventTime = this.opts.eventTimeExtractor?.(value) ?? Date.now();
            const keys = this.opts.policy.assignWindows(eventTime);

            for (const key of keys) {
                const current = await this.opts.state.get(key);
                const events = current ?? [];
                events.push(value);
                await this.opts.state.put(key, events);

                if (
                    this.opts.countTrigger !== undefined &&
                    events.length >= this.opts.countTrigger
                ) {
                    const result = await this._closeWindow(key);
                    if (result !== null) return result;
                }
            }
        } catch (e) {
            if (e instanceof NakError) throw e;
            throw new NakError(`WindowedJoinOperator threw: ${String(e)}`, { cause: e });
        }
    }

    /**
     * Force-close a window by key: cross-join buffered left × right events,
     * filter by predicate, apply merge fn, return matched outputs.
     *
     * Returns null if the key has no state (already closed or never opened).
     */
    async closeWindow(key: string): Promise<O[] | null> {
        return this._closeWindow(key);
    }

    private async _closeWindow(key: string): Promise<O[] | null> {
        const events = await this.opts.state.get(key);
        if (events === null) return null;

        await this.opts.state.delete(key);

        const lefts = events
            .filter((e): e is LeftEvent<L> => e.side === 'left')
            .map(e => e.value);
        const rights = events
            .filter((e): e is RightEvent<R> => e.side === 'right')
            .map(e => e.value);

        const pairs: [L, R][] = [];
        for (const left of lefts) {
            for (const right of rights) {
                if (this.opts.predicate(left, right)) {
                    pairs.push([left, right]);
                }
            }
        }

        if (this.opts.onEmit) {
            await this.opts.onEmit(key, pairs);
        }

        return pairs.map(([l, r]) => this.mergeFn(l, r));
    }
}
