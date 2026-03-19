/**
 * Aggregate Function Engine.
 *
 * Provides accumulator-based evaluation of COUNT, SUM, AVG, MIN, MAX.
 * Each aggregate call produces an AggregateAccumulator which is fed rows
 * one at a time and then asked for its final result.
 */
import type { Expression } from '@zenystx/helios-core/sql/impl/expression/Expression.js';
import { _equals } from '@zenystx/helios-core/sql/impl/expression/Expression.js';
import type { SqlRow } from '@zenystx/helios-core/sql/impl/SqlResult.js';

export type AggregateFunctionName = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';

// ── Accumulator base ────────────────────────────────────────────────────────

export abstract class AggregateAccumulator {
    abstract accumulate(value: unknown): void;
    abstract getResult(): unknown;
}

// ── COUNT ───────────────────────────────────────────────────────────────────

export class CountAccumulator extends AggregateAccumulator {
    private _count = 0;
    private readonly _distinct: boolean;
    private readonly _seen: unknown[] = [];

    constructor(distinct: boolean) {
        super();
        this._distinct = distinct;
    }

    accumulate(value: unknown): void {
        // COUNT(*) passes null as sentinel meaning "always count"
        if (value === undefined) return;
        if (value !== null && value !== undefined) {
            if (this._distinct) {
                if (this._seen.some((v) => _equals(v, value))) return;
                this._seen.push(value);
            }
            this._count++;
        }
    }

    getResult(): unknown {
        return this._count;
    }
}

// ── SUM ────────────────────────────────────────────────────────────────────

export class SumAccumulator extends AggregateAccumulator {
    private _sum: number | null = null;
    private readonly _distinct: boolean;
    private readonly _seen: unknown[] = [];

    constructor(distinct: boolean) {
        super();
        this._distinct = distinct;
    }

    accumulate(value: unknown): void {
        if (value === null || value === undefined) return;
        if (this._distinct) {
            if (this._seen.some((v) => _equals(v, value))) return;
            this._seen.push(value);
        }
        const n = Number(value);
        if (!isNaN(n)) {
            this._sum = (this._sum ?? 0) + n;
        }
    }

    getResult(): unknown {
        return this._sum;
    }
}

// ── AVG ────────────────────────────────────────────────────────────────────

export class AvgAccumulator extends AggregateAccumulator {
    private _sum = 0;
    private _count = 0;
    private readonly _distinct: boolean;
    private readonly _seen: unknown[] = [];

    constructor(distinct: boolean) {
        super();
        this._distinct = distinct;
    }

    accumulate(value: unknown): void {
        if (value === null || value === undefined) return;
        if (this._distinct) {
            if (this._seen.some((v) => _equals(v, value))) return;
            this._seen.push(value);
        }
        const n = Number(value);
        if (!isNaN(n)) {
            this._sum += n;
            this._count++;
        }
    }

    getResult(): unknown {
        if (this._count === 0) return null;
        return this._sum / this._count;
    }
}

// ── MIN ────────────────────────────────────────────────────────────────────

export class MinAccumulator extends AggregateAccumulator {
    private _min: unknown = null;

    accumulate(value: unknown): void {
        if (value === null || value === undefined) return;
        if (this._min === null) {
            this._min = value;
            return;
        }
        const n = Number(value);
        const cur = Number(this._min);
        if (!isNaN(n) && !isNaN(cur)) {
            if (n < cur) this._min = value;
        } else {
            const vs = String(value);
            const cs = String(this._min);
            if (vs < cs) this._min = value;
        }
    }

    getResult(): unknown {
        return this._min;
    }
}

// ── MAX ────────────────────────────────────────────────────────────────────

export class MaxAccumulator extends AggregateAccumulator {
    private _max: unknown = null;

    accumulate(value: unknown): void {
        if (value === null || value === undefined) return;
        if (this._max === null) {
            this._max = value;
            return;
        }
        const n = Number(value);
        const cur = Number(this._max);
        if (!isNaN(n) && !isNaN(cur)) {
            if (n > cur) this._max = value;
        } else {
            const vs = String(value);
            const cs = String(this._max);
            if (vs > cs) this._max = value;
        }
    }

    getResult(): unknown {
        return this._max;
    }
}

// ── AggregateExpression ────────────────────────────────────────────────────

export class AggregateExpression {
    constructor(
        public readonly function_: AggregateFunctionName,
        /** null means COUNT(*) */
        public readonly operand: Expression | null,
        public readonly isDistinct: boolean,
    ) {}

    createAccumulator(): AggregateAccumulator {
        switch (this.function_) {
            case 'COUNT': return new CountAccumulator(this.isDistinct);
            case 'SUM':   return new SumAccumulator(this.isDistinct);
            case 'AVG':   return new AvgAccumulator(this.isDistinct);
            case 'MIN':   return new MinAccumulator();
            case 'MAX':   return new MaxAccumulator();
        }
    }

    /**
     * Evaluate the operand for a single row and feed the result to the accumulator.
     * For COUNT(*), the operand is null; we pass a non-null sentinel so CountAccumulator counts.
     */
    feed(accumulator: AggregateAccumulator, row: SqlRow, key: unknown, value: unknown): void {
        if (this.operand === null) {
            // COUNT(*) — always count every row
            accumulator.accumulate(1);
        } else {
            accumulator.accumulate(this.operand.evaluate(row, key, value));
        }
    }
}
