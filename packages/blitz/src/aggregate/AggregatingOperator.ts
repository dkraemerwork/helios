import { Stage } from '../Stage.ts';
import type { StageContext } from '../StageContext.ts';
import type { Aggregator } from './Aggregator.ts';

/**
 * `AggregatingOperator<T, A, R>` — consumes a closed window (list of events)
 * from `WindowOperator`, runs the aggregation loop, and emits the final result.
 *
 * Extends `Stage<T[], R>`: input is an array of window events, output is `R`.
 */
export class AggregatingOperator<T, A, R> extends Stage<T[], R> {
    constructor(private readonly aggregator: Aggregator<T, A, R>) {
        super();
    }

    override async process(events: T[], _ctx: StageContext): Promise<R> {
        let acc = this.aggregator.create();
        for (const item of events) {
            acc = this.aggregator.accumulate(acc, item);
        }
        return this.aggregator.export(acc);
    }
}

/**
 * `RunningAggregateOperator<T, A, R>` — maintains running accumulator state
 * across events and emits the updated result after every item.
 *
 * Use this for whole-stream running totals without windowing (e.g. a running
 * count or running sum over the lifetime of the pipeline).
 */
export class RunningAggregateOperator<T, A, R> extends Stage<T, R> {
    private _acc: A;

    constructor(private readonly aggregator: Aggregator<T, A, R>) {
        super();
        this._acc = aggregator.create();
    }

    override async process(item: T, _ctx: StageContext): Promise<R> {
        this._acc = this.aggregator.accumulate(this._acc, item);
        return this.aggregator.export(this._acc);
    }
}
