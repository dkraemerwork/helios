import { Stage } from '../Stage.js';
import type { StageContext } from '../StageContext.js';
import { SessionWindowPolicy } from './SessionWindowPolicy.js';
import type { WindowPolicy } from './WindowPolicy.js';
import type { WindowState } from './WindowState.js';

/**
 * Configuration for WindowOperator.
 */
export interface WindowOperatorOptions<T> {
    /** Window policy that assigns events to window key(s). */
    policy: WindowPolicy;

    /** Durable window accumulator store (InMemoryWindowState for tests, NatsKvWindowState for production). */
    state: WindowState<T[]>;

    /**
     * Close a window after accumulating this many events.
     * Useful for unit tests and count-based tumbling windows.
     * If unset, only processing-time timers and `closeWindow()` close windows.
     */
    countTrigger?: number;

    /**
     * Maximum lateness for late arrivals (ms). Default: 0.
     * Events with eventTime < (windowEnd - allowedLateness) are still accepted.
     */
    allowedLateness?: number;

    /**
     * Called when a window closes. Receives the window key and accumulated events.
     * If onEmit throws, the window KV key is NOT deleted (window remains for retry).
     * Deletion failure is logged but does not block pipeline progress.
     */
    onEmit?: (key: string, events: T[]) => void | Promise<void>;

    /**
     * Extract event time from the value. Defaults to `Date.now()`.
     * Override for deterministic tests: `eventTimeExtractor: () => fixedTimestamp`.
     */
    eventTimeExtractor?: (value: T) => number;
}

/**
 * WindowOperator accumulates events into windows and emits complete windows when triggered.
 *
 * Processing contract:
 * 1. On each event:
 *    a. Determine window key(s) via policy.assignWindows() (or session resolveKey()).
 *    b. Append event to accumulator in WindowState.
 *    c. Check close trigger (count-based or timer-based).
 * 2. On window CLOSE:
 *    a. Call onEmit(key, events) if provided.
 *    b. If emit succeeds → call windowState.delete(key).
 *    c. If emit fails → skip delete (window remains for retry).
 *    d. Deletion failure is logged but does not block pipeline progress.
 * 3. Returns closed window events as stage output (T[] or T[][] for multiple closes).
 */
export class WindowOperator<T> extends Stage<T, T[]> {
    private readonly _allowedLateness: number;
    private readonly _countTrigger: number | undefined;
    private readonly _eventTimeExtractor: (value: T) => number;

    /** Open session windows: key → lastEventTime (only used for SessionWindowPolicy). */
    private readonly _openSessions = new Map<string, number>();

    /** Processing-time close timers: key → timer handle. */
    private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private readonly opts: WindowOperatorOptions<T>) {
        super();
        this._allowedLateness = opts.allowedLateness ?? 0;
        this._countTrigger = opts.countTrigger;
        this._eventTimeExtractor = opts.eventTimeExtractor ?? (() => Date.now());
    }

    /**
     * Process one event: accumulate into window(s), trigger close if applicable.
     *
     * Returns:
     * - `void` if no window closed
     * - `T[]` if exactly one window closed (its accumulated events)
     * - `T[][]` if multiple windows closed (one inner array per closed window)
     */
    override async process(value: T, _ctx: StageContext): Promise<T[] | T[][] | void> {
        const eventTime = this._eventTimeExtractor(value);
        const policy = this.opts.policy;

        let windowKeys: string[];
        if (policy instanceof SessionWindowPolicy) {
            // Session-aware key resolution uses open session map
            const key = policy.resolveKey(eventTime, this._openSessions);
            windowKeys = [key];
            this._openSessions.set(key, eventTime);
            // Reset (or start) the inactivity close timer
            this._scheduleSessionClose(key, policy.gapMs);
        } else {
            windowKeys = policy.assignWindows(eventTime);
        }

        const closedWindows: T[][] = [];

        for (const key of windowKeys) {
            // Accumulate event
            const current = await this.opts.state.get(key);
            const events = current ?? [];
            events.push(value);
            await this.opts.state.put(key, events);

            // Count trigger check
            if (this._countTrigger !== undefined && events.length >= this._countTrigger) {
                const closed = await this._closeWindow(key);
                if (closed !== null) {
                    closedWindows.push(closed);
                }
            }
        }

        if (closedWindows.length === 0) return;
        if (closedWindows.length === 1) return closedWindows[0];
        return closedWindows;
    }

    /**
     * Force-close a window by key.
     * Returns the accumulated events, or null if the key is not in state.
     */
    async closeWindow(key: string): Promise<T[] | null> {
        return this._closeWindow(key);
    }

    private async _closeWindow(key: string): Promise<T[] | null> {
        const events = await this.opts.state.get(key);
        if (events === null) return null;

        // Cancel processing-time timer if any
        const timer = this._timers.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._timers.delete(key);
        }

        // Remove from session tracking
        this._openSessions.delete(key);

        // Emit — if this throws, do NOT delete (leave for retry)
        if (this.opts.onEmit) {
            try {
                await this.opts.onEmit(key, events);
            } catch {
                // Emit failed — leave KV key intact for retry
                return null;
            }
        }

        // Delete from state after successful emit
        try {
            await this.opts.state.delete(key);
        } catch (e) {
            // Log but do not block pipeline — bucket TTL backstop will clean up
            console.warn(`[WindowOperator] Failed to delete window key ${key}:`, e);
        }

        return events;
    }

    /**
     * Schedule a session close timer.
     * Resets the timer if one already exists for this key.
     */
    private _scheduleSessionClose(key: string, gapMs: number): void {
        const existing = this._timers.get(key);
        if (existing !== undefined) clearTimeout(existing);

        const timer = setTimeout(() => {
            this._timers.delete(key);
            this._closeWindow(key).catch((e) => {
                console.warn(`[WindowOperator] Session close error for key ${key}:`, e);
            });
        }, gapMs);

        this._timers.set(key, timer);
    }
}
