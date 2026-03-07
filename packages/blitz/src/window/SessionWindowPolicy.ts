import type { WindowKey, WindowPolicy } from './WindowPolicy.js';

export interface SessionWindowOptions {
    /** Inactivity gap in milliseconds. A new session starts when no event arrives for gapMs. */
    gapMs: number;
}

/**
 * Gap-based session windows — a window stays open as long as events arrive within `gapMs`.
 *
 * Unlike tumbling/sliding windows, session windows have no fixed boundaries — they grow
 * dynamically as events extend an open session.
 *
 * `maxDurationMs = gapMs * 2`, making the NATS KV bucket TTL = gapMs * 6 (per spec).
 *
 * Two methods:
 * - `assignWindows(eventTime)` — fallback epoch-based assignment (stateless).
 *   Returns a single key `session:{epoch}` where epoch = floor(eventTime / gapMs) * gapMs.
 *   Only correct for single-event use; use `resolveKey()` in WindowOperator for stateful tracking.
 *
 * - `resolveKey(eventTime, openSessions)` — stateful session resolution.
 *   Finds an open session whose `lastEventTime` is within gapMs of `eventTime`.
 *   If found, returns that session's key (extended). If not found, creates a new key.
 */
export class SessionWindowPolicy implements WindowPolicy {
    readonly maxDurationMs: number;

    private constructor(readonly gapMs: number) {
        // bucket TTL = maxDurationMs * 3 = gapMs * 6
        this.maxDurationMs = gapMs * 2;
    }

    static of(opts: SessionWindowOptions): SessionWindowPolicy {
        if (opts.gapMs <= 0) throw new Error('SessionWindowPolicy: gapMs must be > 0');
        return new SessionWindowPolicy(opts.gapMs);
    }

    /**
     * Stateless epoch-based assignment. Assigns to `session:{epoch}`.
     * For correct session semantics, use `resolveKey()` inside WindowOperator.
     */
    assignWindows(eventTime: number): WindowKey[] {
        const epoch = Math.floor(eventTime / this.gapMs) * this.gapMs;
        return [`session:${epoch}`];
    }

    /**
     * Stateful session key resolution.
     *
     * @param eventTime - the current event's timestamp
     * @param openSessions - map of open session keys → lastEventTime
     * @returns the existing session key to extend, or a new `session:{eventTime}` key
     */
    resolveKey(eventTime: number, openSessions: ReadonlyMap<string, number>): WindowKey {
        let bestKey: string | null = null;
        let bestTime = -Infinity;

        for (const [key, lastTime] of openSessions) {
            if (eventTime - lastTime <= this.gapMs && lastTime > bestTime) {
                bestKey = key;
                bestTime = lastTime;
            }
        }

        return bestKey ?? `session:${eventTime}`;
    }
}
