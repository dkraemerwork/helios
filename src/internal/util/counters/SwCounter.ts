/**
 * Port of {@code com.hazelcast.internal.util.counters.SwCounter}.
 * A single-writer counter. Bun is single-threaded so no volatile/VarHandle needed.
 */
import type { Counter } from '@helios/internal/util/counters/Counter';

export class SwCounter implements Counter {
    private _value: bigint;

    private constructor(initialValue: bigint) {
        this._value = initialValue;
    }

    static newSwCounter(initialValue: bigint = 0n): SwCounter {
        return new SwCounter(initialValue);
    }

    get(): bigint {
        return this._value;
    }

    set(value: bigint): void {
        this._value = value;
    }

    getAndSet(newValue: bigint): bigint {
        const old = this._value;
        this._value = newValue;
        return old;
    }

    inc(amount: bigint = 1n): bigint {
        this._value += amount;
        return this._value;
    }

    toString(): string {
        return `Counter{value=${this._value}}`;
    }
}
