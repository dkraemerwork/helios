import type { WindowKey, WindowPolicy } from './WindowPolicy.ts';

export interface TumblingWindowOptions {
    /** Window duration in milliseconds. */
    size: number;
}

/**
 * Non-overlapping, fixed-duration windows.
 *
 * Each event belongs to exactly one window.
 * Window key format: `tumbling:{start}:{end}`.
 *
 * Example: size=60_000 → windows [0,60000), [60000,120000), ...
 */
export class TumblingWindowPolicy implements WindowPolicy {
    readonly maxDurationMs: number;

    private constructor(private readonly size: number) {
        this.maxDurationMs = size;
    }

    static of(opts: TumblingWindowOptions): TumblingWindowPolicy {
        if (opts.size <= 0) throw new Error('TumblingWindowPolicy: size must be > 0');
        return new TumblingWindowPolicy(opts.size);
    }

    assignWindows(eventTime: number): WindowKey[] {
        const start = Math.floor(eventTime / this.size) * this.size;
        const end = start + this.size;
        return [`tumbling:${start}:${end}`];
    }
}
