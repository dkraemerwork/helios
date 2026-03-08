/**
 * ResourceLimiter — production connection and request bounding for Helios.
 *
 * Enforces:
 *   - Max concurrent client connections (default 1 000)
 *   - Max in-flight requests per connection (default 100)
 *   - Max listener registrations per session (default 500)
 *   - Max near-cache entries globally (configurable)
 *   - Reconnect storm protection: max 1 reconnect attempt per member per second
 *   - Request queue depth limit with backpressure (reject when full)
 *
 * All limits are checked synchronously (no async paths in hot code).
 * Counters are plain numbers — no allocation on the critical path.
 */

import { HeliosLoggers } from '@zenystx/helios-core/monitor/StructuredLogger';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface ResourceLimiterConfig {
    /** Maximum concurrent client connections. Default: 1 000. */
    maxConnections?: number;

    /** Maximum in-flight requests per connection. Default: 100. */
    maxRequestsPerConnection?: number;

    /** Maximum listener registrations per client session. Default: 500. */
    maxListenersPerSession?: number;

    /** Maximum near-cache entries across all maps. 0 = unlimited. Default: 0. */
    maxNearCacheEntries?: number;

    /**
     * Reconnect storm protection: minimum milliseconds between reconnect
     * attempts per member. Default: 1 000 ms (i.e., max 1 per second).
     */
    reconnectMinIntervalMs?: number;

    /** Maximum pending requests in the global request queue. Default: 10 000. */
    maxQueueDepth?: number;
}

const DEFAULTS: Required<ResourceLimiterConfig> = {
    maxConnections:           1_000,
    maxRequestsPerConnection:   100,
    maxListenersPerSession:     500,
    maxNearCacheEntries:          0, // unlimited by default
    reconnectMinIntervalMs:   1_000,
    maxQueueDepth:           10_000,
};

// ── Errors ────────────────────────────────────────────────────────────────────

export class ConnectionLimitExceededError extends Error {
    constructor(active: number, limit: number) {
        super(`Connection limit exceeded: ${active}/${limit} active connections`);
        this.name = 'ConnectionLimitExceededError';
    }
}

export class RequestLimitExceededError extends Error {
    constructor(connectionId: string, active: number, limit: number) {
        super(`Request limit exceeded for connection ${connectionId}: ${active}/${limit} in-flight`);
        this.name = 'RequestLimitExceededError';
    }
}

export class ListenerLimitExceededError extends Error {
    constructor(sessionId: string, count: number, limit: number) {
        super(`Listener limit exceeded for session ${sessionId}: ${count}/${limit} registrations`);
        this.name = 'ListenerLimitExceededError';
    }
}

export class NearCacheLimitExceededError extends Error {
    constructor(size: number, limit: number) {
        super(`Near-cache entry limit exceeded: ${size}/${limit} entries`);
        this.name = 'NearCacheLimitExceededError';
    }
}

export class QueueDepthExceededError extends Error {
    constructor(depth: number, limit: number) {
        super(`Request queue depth exceeded: ${depth}/${limit}`);
        this.name = 'QueueDepthExceededError';
    }
}

export class ReconnectStormError extends Error {
    constructor(memberId: string, nextAllowedAt: number) {
        const waitMs = nextAllowedAt - Date.now();
        super(`Reconnect storm protection: member ${memberId} reconnect denied, next allowed in ${waitMs}ms`);
        this.name = 'ReconnectStormError';
    }
}

// ── Per-connection state ──────────────────────────────────────────────────────

interface ConnectionState {
    connectionId: string;
    activeRequests: number;
}

// ── ResourceLimiter ───────────────────────────────────────────────────────────

export class ResourceLimiter {
    private readonly _cfg: Required<ResourceLimiterConfig>;
    private readonly _log = HeliosLoggers.connection;

    // Active connections: connectionId → state
    private readonly _connections = new Map<string, ConnectionState>();

    // Per-session listener counts: sessionId → count
    private readonly _sessionListeners = new Map<string, number>();

    // Global near-cache entry count (maintained by caller via incrementNearCache/decrementNearCache)
    private _nearCacheEntries = 0;

    // Reconnect timestamps: memberId → last-allowed reconnect attempt timestamp
    private readonly _reconnectTimestamps = new Map<string, number>();

    // Global request queue depth
    private _queueDepth = 0;

    // Stats
    private _totalConnectionsCreated = 0;
    private _totalConnectionsRejected = 0;
    private _totalRequestsRejected = 0;
    private _totalListenersRejected = 0;
    private _totalNearCacheEvictions = 0;
    private _totalReconnectsDenied = 0;

    constructor(config: ResourceLimiterConfig = {}) {
        this._cfg = { ...DEFAULTS, ...config };
    }

    // ── Connection management ─────────────────────────────────────────────────

    /**
     * Attempt to admit a new client connection.
     *
     * @throws {ConnectionLimitExceededError} when the connection limit is reached.
     */
    admitConnection(connectionId: string): void {
        const active = this._connections.size;
        if (active >= this._cfg.maxConnections) {
            this._totalConnectionsRejected += 1;
            this._log.warn('Connection rejected: limit reached', {
                connectionId,
                active,
                limit: this._cfg.maxConnections,
                event: 'connection.rejected',
            });
            throw new ConnectionLimitExceededError(active, this._cfg.maxConnections);
        }

        this._connections.set(connectionId, { connectionId, activeRequests: 0 });
        this._totalConnectionsCreated += 1;
    }

    /**
     * Release a connection when it is closed.
     * Also removes all associated in-flight request tracking.
     */
    releaseConnection(connectionId: string): void {
        this._connections.delete(connectionId);
    }

    /** Number of currently open connections. */
    get activeConnections(): number {
        return this._connections.size;
    }

    /** Maximum allowed connections. */
    get maxConnections(): number {
        return this._cfg.maxConnections;
    }

    // ── Per-connection request tracking ───────────────────────────────────────

    /**
     * Attempt to add an in-flight request for the given connection.
     *
     * @throws {RequestLimitExceededError} when the per-connection request limit is exceeded.
     */
    admitRequest(connectionId: string): void {
        const state = this._connections.get(connectionId);
        if (state === undefined) {
            // Connection not tracked — create an implicit entry (best effort)
            this._connections.set(connectionId, { connectionId, activeRequests: 1 });
            return;
        }

        if (state.activeRequests >= this._cfg.maxRequestsPerConnection) {
            this._totalRequestsRejected += 1;
            throw new RequestLimitExceededError(connectionId, state.activeRequests, this._cfg.maxRequestsPerConnection);
        }

        state.activeRequests += 1;
    }

    /** Mark a request as complete (decrements in-flight count for the connection). */
    releaseRequest(connectionId: string): void {
        const state = this._connections.get(connectionId);
        if (state !== undefined && state.activeRequests > 0) {
            state.activeRequests -= 1;
        }
    }

    /** In-flight request count for a specific connection. */
    activeRequestsForConnection(connectionId: string): number {
        return this._connections.get(connectionId)?.activeRequests ?? 0;
    }

    // ── Listener tracking ─────────────────────────────────────────────────────

    /**
     * Attempt to register a listener for the given session.
     *
     * @throws {ListenerLimitExceededError} when the per-session limit is exceeded.
     */
    admitListener(sessionId: string): void {
        const current = this._sessionListeners.get(sessionId) ?? 0;
        if (current >= this._cfg.maxListenersPerSession) {
            this._totalListenersRejected += 1;
            throw new ListenerLimitExceededError(sessionId, current, this._cfg.maxListenersPerSession);
        }
        this._sessionListeners.set(sessionId, current + 1);
    }

    /** Remove a listener registration for the given session. */
    releaseListener(sessionId: string): void {
        const current = this._sessionListeners.get(sessionId) ?? 0;
        if (current <= 1) {
            this._sessionListeners.delete(sessionId);
        } else {
            this._sessionListeners.set(sessionId, current - 1);
        }
    }

    /** Remove all listener registrations for a session (called on session close). */
    releaseAllListeners(sessionId: string): void {
        this._sessionListeners.delete(sessionId);
    }

    /** Listener count for a specific session. */
    listenerCountForSession(sessionId: string): number {
        return this._sessionListeners.get(sessionId) ?? 0;
    }

    // ── Near-cache entry bounding ─────────────────────────────────────────────

    /**
     * Check whether the global near-cache entry limit would be exceeded.
     * Returns true if the entry can be admitted; false if it should be evicted.
     *
     * @throws {NearCacheLimitExceededError} when limit is exceeded and rejectOnExceed=true.
     */
    canAdmitNearCacheEntry(rejectOnExceed: boolean = false): boolean {
        if (this._cfg.maxNearCacheEntries === 0) return true; // unlimited

        if (this._nearCacheEntries >= this._cfg.maxNearCacheEntries) {
            this._totalNearCacheEvictions += 1;
            if (rejectOnExceed) {
                throw new NearCacheLimitExceededError(this._nearCacheEntries, this._cfg.maxNearCacheEntries);
            }
            return false;
        }
        return true;
    }

    /** Increment the global near-cache entry counter. */
    incrementNearCache(): void {
        this._nearCacheEntries += 1;
    }

    /** Decrement the global near-cache entry counter (on eviction or invalidation). */
    decrementNearCache(count: number = 1): void {
        this._nearCacheEntries = Math.max(0, this._nearCacheEntries - count);
    }

    /** Current global near-cache entry count. */
    get nearCacheEntries(): number {
        return this._nearCacheEntries;
    }

    // ── Reconnect storm protection ────────────────────────────────────────────

    /**
     * Check whether a reconnect attempt for the given member is allowed.
     * Enforces a minimum interval between reconnect attempts per member.
     *
     * @param now — current timestamp (injectable for testing; defaults to Date.now())
     * @throws {ReconnectStormError} when the interval has not elapsed since the last attempt.
     */
    checkReconnectAllowed(memberId: string, now: number = Date.now()): void {
        const lastAttempt = this._reconnectTimestamps.get(memberId);
        if (lastAttempt !== undefined) {
            const nextAllowed = lastAttempt + this._cfg.reconnectMinIntervalMs;
            if (now < nextAllowed) {
                this._totalReconnectsDenied += 1;
                this._log.warn('Reconnect storm protection triggered', {
                    memberId,
                    nextAllowedAt: new Date(nextAllowed).toISOString(),
                    waitMs: nextAllowed - now,
                    event: 'reconnect.storm.denied',
                });
                throw new ReconnectStormError(memberId, nextAllowed);
            }
        }
        this._reconnectTimestamps.set(memberId, now);
    }

    /** Remove reconnect tracking for a member (e.g., after successful stable connection). */
    clearReconnectTracking(memberId: string): void {
        this._reconnectTimestamps.delete(memberId);
    }

    // ── Queue depth control ───────────────────────────────────────────────────

    /**
     * Admit a request into the global pending queue.
     *
     * @throws {QueueDepthExceededError} when the queue depth limit is reached.
     */
    admitQueueEntry(): void {
        if (this._queueDepth >= this._cfg.maxQueueDepth) {
            throw new QueueDepthExceededError(this._queueDepth, this._cfg.maxQueueDepth);
        }
        this._queueDepth += 1;
    }

    /** Remove an entry from the queue (on completion or rejection). */
    releaseQueueEntry(): void {
        if (this._queueDepth > 0) this._queueDepth -= 1;
    }

    /** Current global request queue depth. */
    get queueDepth(): number {
        return this._queueDepth;
    }

    // ── Snapshot / observability ──────────────────────────────────────────────

    /** Returns a point-in-time snapshot of all resource limiter counters. */
    getSnapshot(): ResourceLimiterSnapshot {
        return {
            activeConnections:         this._connections.size,
            maxConnections:            this._cfg.maxConnections,
            totalConnectionsCreated:   this._totalConnectionsCreated,
            totalConnectionsRejected:  this._totalConnectionsRejected,
            totalRequestsRejected:     this._totalRequestsRejected,
            totalListenersRejected:    this._totalListenersRejected,
            nearCacheEntries:          this._nearCacheEntries,
            maxNearCacheEntries:       this._cfg.maxNearCacheEntries,
            totalNearCacheEvictions:   this._totalNearCacheEvictions,
            totalReconnectsDenied:     this._totalReconnectsDenied,
            queueDepth:                this._queueDepth,
            maxQueueDepth:             this._cfg.maxQueueDepth,
        };
    }

    /** Reset all counters — for testing only. Does not affect active tracking state. */
    resetCounters(): void {
        this._totalConnectionsCreated = 0;
        this._totalConnectionsRejected = 0;
        this._totalRequestsRejected = 0;
        this._totalListenersRejected = 0;
        this._totalNearCacheEvictions = 0;
        this._totalReconnectsDenied = 0;
    }

    /** Force-reset all state — for testing only. */
    resetAll(): void {
        this._connections.clear();
        this._sessionListeners.clear();
        this._reconnectTimestamps.clear();
        this._nearCacheEntries = 0;
        this._queueDepth = 0;
        this.resetCounters();
    }
}

// ── Snapshot type ─────────────────────────────────────────────────────────────

export interface ResourceLimiterSnapshot {
    activeConnections: number;
    maxConnections: number;
    totalConnectionsCreated: number;
    totalConnectionsRejected: number;
    totalRequestsRejected: number;
    totalListenersRejected: number;
    nearCacheEntries: number;
    maxNearCacheEntries: number;
    totalNearCacheEvictions: number;
    totalReconnectsDenied: number;
    queueDepth: number;
    maxQueueDepth: number;
}

// ── Module-level singleton ────────────────────────────────────────────────────

/** Global instance with default limits. Override at startup if needed. */
export const globalResourceLimiter = new ResourceLimiter();
