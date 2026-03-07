import type { WindowKey, WindowPolicy } from './WindowPolicy.js';

export interface SlidingWindowOptions {
    /** Window duration in milliseconds. */
    size: number;
    /** Slide interval in milliseconds. Must be > 0 and <= size. */
    slide: number;
}

/**
 * Overlapping fixed-duration windows that advance by a slide interval.
 *
 * An event may appear in multiple windows (size / slide windows on average).
 * Window key format: `sliding:{start}:{end}`.
 *
 * Example: size=60_000, slide=30_000 → event at t=45_000 is in [0,60000) and [30000,90000).
 */
export class SlidingWindowPolicy implements WindowPolicy {
    readonly maxDurationMs: number;

    private constructor(
        private readonly size: number,
        private readonly slide: number,
    ) {
        this.maxDurationMs = size;
    }

    static of(opts: SlidingWindowOptions): SlidingWindowPolicy {
        if (opts.size <= 0) throw new Error('SlidingWindowPolicy: size must be > 0');
        if (opts.slide <= 0) throw new Error('SlidingWindowPolicy: slide must be > 0');
        if (opts.slide > opts.size) throw new Error('SlidingWindowPolicy: slide must be <= size');
        return new SlidingWindowPolicy(opts.size, opts.slide);
    }

    assignWindows(eventTime: number): WindowKey[] {
        const keys: WindowKey[] = [];
        // Windows containing `eventTime`: those starting at k*slide where
        //   k*slide <= eventTime  AND  eventTime < k*slide + size
        // → k <= eventTime/slide  AND  k > (eventTime - size) / slide
        // → k in [ceil((eventTime - size + 1) / slide), floor(eventTime / slide)]
        // Clamp kMin to 0 so we never emit windows with negative start times.
        const kMin = Math.max(0, Math.ceil((eventTime - this.size + 1) / this.slide));
        const kMax = Math.floor(eventTime / this.slide);
        for (let k = kMin; k <= kMax; k++) {
            const start = k * this.slide;
            const end = start + this.size;
            keys.push(`sliding:${start}:${end}`);
        }
        return keys;
    }
}
