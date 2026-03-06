/**
 * Port of {@code com.hazelcast.internal.util.counters.MwCounter}.
 *
 * Multi-writer counter. In single-threaded Bun, identical to SwCounter.
 */
import type { Counter } from '@zenystx/helios-core/internal/util/counters/Counter';

export class MwCounter implements Counter {
    private _value: bigint;

    private constructor(initialValue: bigint) {
        this._value = initialValue;
    }

    static newMwCounter(initialValue: bigint = 0n): MwCounter {
        return new MwCounter(initialValue);
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
