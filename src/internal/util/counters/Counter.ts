/**
 * Port of {@code com.hazelcast.internal.util.counters.Counter}.
 * A Counter keeps track of a long value (represented as bigint).
 */
export interface Counter {
    get(): bigint;
    set(value: bigint): void;
    getAndSet(newValue: bigint): bigint;
    inc(): bigint;
    inc(amount: bigint): bigint;
}
