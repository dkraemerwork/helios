/**
 * StructuredLogger — production-ready structured logging for Helios.
 *
 * Features:
 *   - JSON output with timestamp, level, logger name, message, and context fields
 *   - Log levels: TRACE < DEBUG < INFO < WARN < ERROR < FATAL
 *   - Named loggers with per-logger configurable minimum level
 *   - Zero-allocation fast path: disabled levels perform a single numeric comparison
 *   - Structured context fields: member UUID, cluster name, connection ID, session ID
 *   - Thread-safe: all writes are synchronous on the JS event loop
 *
 * Key lifecycle events logged:
 *   - Auth success/failure
 *   - Member joined/left
 *   - Partition migration start/end
 *   - Routing correction (wrong target → retry)
 *   - Invocation timeout
 *   - Listener recovery attempt/failure
 *   - Connection lost/reconnect
 *   - Protocol error
 *   - Near-cache reconciliation
 *   - Transaction commit/rollback
 *   - TLS negotiation
 */

// ── Log levels ────────────────────────────────────────────────────────────────

export const LogLevel = {
    TRACE: 0,
    DEBUG: 1,
    INFO:  2,
    WARN:  3,
    ERROR: 4,
    FATAL: 5,
    OFF:   6,
} as const;

export type LogLevelName = keyof typeof LogLevel;
export type LogLevelValue = (typeof LogLevel)[LogLevelName];

const LEVEL_NAMES: Record<LogLevelValue, LogLevelName> = {
    0: 'TRACE',
    1: 'DEBUG',
    2: 'INFO',
    3: 'WARN',
    4: 'ERROR',
    5: 'FATAL',
    6: 'OFF',
};

// ── Context fields ────────────────────────────────────────────────────────────

export interface LogContext {
    /** Member UUID of the local Helios node. */
    memberUuid?: string;
    /** Cluster name. */
    clusterName?: string;
    /** Connection identifier (TCP channel or client session). */
    connectionId?: string;
    /** Client session identifier. */
    sessionId?: string;
    /** Additional arbitrary key-value context fields. */
    [key: string]: unknown;
}

// ── Log entry (JSON wire format) ──────────────────────────────────────────────

export interface LogEntry {
    timestamp: string;   // ISO-8601
    level: LogLevelName;
    logger: string;
    message: string;
    context: LogContext;
}

// ── Output sink ───────────────────────────────────────────────────────────────

export type LogSink = (entry: LogEntry) => void;

/** Default sink: write JSON line to stderr (production) or stdout (dev). */
const stdoutSink: LogSink = (entry) => {
    process.stdout.write(JSON.stringify(entry) + '\n');
};

const stderrSink: LogSink = (entry) => {
    process.stderr.write(JSON.stringify(entry) + '\n');
};

// ── Logger factory / registry ─────────────────────────────────────────────────

/**
 * Controls global logging behaviour.
 * All Logger instances created via LoggerFactory.getLogger() share this config.
 */
export class LoggerFactory {
    private static _globalLevel: LogLevelValue = LogLevel.INFO;
    private static _overrides = new Map<string, LogLevelValue>();
    private static _sink: LogSink = stdoutSink;
    private static _errorSink: LogSink = stderrSink;
    private static _globalContext: LogContext = {};

    /** Set the default minimum log level (applies when no per-logger override exists). */
    static setGlobalLevel(level: LogLevelName | LogLevelValue): void {
        LoggerFactory._globalLevel = typeof level === 'string' ? LogLevel[level] : level;
    }

    /** Set a minimum level for a specific named logger. */
    static setLoggerLevel(loggerName: string, level: LogLevelName | LogLevelValue): void {
        const val = typeof level === 'string' ? LogLevel[level] : level;
        if (val === LoggerFactory._globalLevel) {
            LoggerFactory._overrides.delete(loggerName);
        } else {
            LoggerFactory._overrides.set(loggerName, val);
        }
    }

    /** Override the output sink (e.g., for testing). */
    static setSink(sink: LogSink): void {
        LoggerFactory._sink = sink;
    }

    /** Override the error-level sink (defaults to stderr). */
    static setErrorSink(sink: LogSink): void {
        LoggerFactory._errorSink = sink;
    }

    /** Set global context fields merged into every log entry. */
    static setGlobalContext(ctx: LogContext): void {
        LoggerFactory._globalContext = { ...ctx };
    }

    /** Merge additional fields into the global context. */
    static mergeGlobalContext(ctx: Partial<LogContext>): void {
        Object.assign(LoggerFactory._globalContext, ctx);
    }

    /** Returns a named logger. Loggers are lightweight; no caching needed. */
    static getLogger(name: string): Logger {
        return new Logger(name, LoggerFactory);
    }

    /** @internal — called by Logger instances */
    static _getEffectiveLevel(loggerName: string): LogLevelValue {
        return LoggerFactory._overrides.get(loggerName) ?? LoggerFactory._globalLevel;
    }

    /** @internal — called by Logger instances */
    static _emit(entry: LogEntry): void {
        const sink = entry.level === 'ERROR' || entry.level === 'FATAL'
            ? LoggerFactory._errorSink
            : LoggerFactory._sink;
        try {
            sink(entry);
        } catch {
            // Swallow sink errors — don't let broken logging crash the process
        }
    }

    /** @internal — build a LogEntry with merged context */
    static _buildEntry(
        level: LogLevelValue,
        loggerName: string,
        message: string,
        ctx?: LogContext,
    ): LogEntry {
        const merged: LogContext = Object.assign(
            {},
            LoggerFactory._globalContext,
            ctx,
        );

        return {
            timestamp: new Date().toISOString(),
            level: LEVEL_NAMES[level],
            logger: loggerName,
            message,
            context: merged,
        };
    }

    /** Reset all overrides and restore defaults (test use). */
    static reset(): void {
        LoggerFactory._globalLevel = LogLevel.INFO;
        LoggerFactory._overrides.clear();
        LoggerFactory._sink = stdoutSink;
        LoggerFactory._errorSink = stderrSink;
        LoggerFactory._globalContext = {};
    }
}

// ── Logger ────────────────────────────────────────────────────────────────────

/**
 * Named, level-aware logger.
 *
 * Zero-allocation hot path: `logger.isDebugEnabled()` is a single
 * numeric comparison — no string allocations occur when a level is disabled.
 */
export class Logger {
    constructor(
        private readonly _name: string,
        private readonly _factory: typeof LoggerFactory,
    ) {}

    get name(): string { return this._name; }

    // ── Level guards — zero alloc on disabled levels ──────────────────────

    isTraceEnabled(): boolean { return this._factory._getEffectiveLevel(this._name) <= LogLevel.TRACE; }
    isDebugEnabled(): boolean { return this._factory._getEffectiveLevel(this._name) <= LogLevel.DEBUG; }
    isInfoEnabled():  boolean { return this._factory._getEffectiveLevel(this._name) <= LogLevel.INFO;  }
    isWarnEnabled():  boolean { return this._factory._getEffectiveLevel(this._name) <= LogLevel.WARN;  }
    isErrorEnabled(): boolean { return this._factory._getEffectiveLevel(this._name) <= LogLevel.ERROR; }

    // ── Logging methods ───────────────────────────────────────────────────

    trace(message: string, ctx?: LogContext): void {
        if (this._factory._getEffectiveLevel(this._name) > LogLevel.TRACE) return;
        this._factory._emit(this._factory._buildEntry(LogLevel.TRACE, this._name, message, ctx));
    }

    debug(message: string, ctx?: LogContext): void {
        if (this._factory._getEffectiveLevel(this._name) > LogLevel.DEBUG) return;
        this._factory._emit(this._factory._buildEntry(LogLevel.DEBUG, this._name, message, ctx));
    }

    info(message: string, ctx?: LogContext): void {
        if (this._factory._getEffectiveLevel(this._name) > LogLevel.INFO) return;
        this._factory._emit(this._factory._buildEntry(LogLevel.INFO, this._name, message, ctx));
    }

    warn(message: string, ctx?: LogContext): void {
        if (this._factory._getEffectiveLevel(this._name) > LogLevel.WARN) return;
        this._factory._emit(this._factory._buildEntry(LogLevel.WARN, this._name, message, ctx));
    }

    error(message: string, ctx?: LogContext): void {
        if (this._factory._getEffectiveLevel(this._name) > LogLevel.ERROR) return;
        this._factory._emit(this._factory._buildEntry(LogLevel.ERROR, this._name, message, ctx));
    }

    fatal(message: string, ctx?: LogContext): void {
        // FATAL always emits regardless of configured level
        this._factory._emit(this._factory._buildEntry(LogLevel.FATAL, this._name, message, ctx));
    }

    // ── Convenience: log with Error object ───────────────────────────────

    errorWithCause(message: string, error: unknown, ctx?: LogContext): void {
        const errCtx: LogContext = {
            ...ctx,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
        };
        this.error(message, errCtx);
    }

    warnWithCause(message: string, error: unknown, ctx?: LogContext): void {
        const errCtx: LogContext = {
            ...ctx,
            errorMessage: error instanceof Error ? error.message : String(error),
        };
        this.warn(message, errCtx);
    }
}

// ── Pre-defined loggers for key Helios subsystems ─────────────────────────────

/** Logger registry — module-level named loggers for all Helios subsystems. */
export const HeliosLoggers = {
    /** Authentication — auth success/failure */
    auth:         LoggerFactory.getLogger('hz.auth'),

    /** Cluster membership — member join/leave */
    cluster:      LoggerFactory.getLogger('hz.cluster'),

    /** Partition management — migration start/end */
    partition:    LoggerFactory.getLogger('hz.partition'),

    /** Invocation service — timeout, retry, routing correction */
    invocation:   LoggerFactory.getLogger('hz.invocation'),

    /** Client connection lifecycle — lost, reconnect */
    connection:   LoggerFactory.getLogger('hz.connection'),

    /** Listener management — registration, recovery */
    listener:     LoggerFactory.getLogger('hz.listener'),

    /** Protocol errors — frame decode failures, unexpected messages */
    protocol:     LoggerFactory.getLogger('hz.protocol'),

    /** Near-cache — reconciliation, stale reads */
    nearCache:    LoggerFactory.getLogger('hz.nearCache'),

    /** Transaction lifecycle — commit, rollback, timeout */
    transaction:  LoggerFactory.getLogger('hz.transaction'),

    /** TLS negotiation */
    tls:          LoggerFactory.getLogger('hz.tls'),

    /** SQL engine */
    sql:          LoggerFactory.getLogger('hz.sql'),

    /** Serialization engine */
    serialization: LoggerFactory.getLogger('hz.serialization'),

    /** General Helios instance lifecycle */
    instance:     LoggerFactory.getLogger('hz.instance'),

    /** Health monitor — periodic health snapshots and threshold violations */
    healthMonitor: LoggerFactory.getLogger('hz.healthMonitor'),
} as const;

// ── Typed event-logging helpers ───────────────────────────────────────────────

/** Log auth success. */
export function logAuthSuccess(username: string, connectionId: string, memberUuid?: string): void {
    HeliosLoggers.auth.info('Client authentication succeeded', {
        username,
        connectionId,
        memberUuid,
        event: 'auth.success',
    });
}

/** Log auth failure. */
export function logAuthFailure(reason: string, connectionId: string, memberUuid?: string): void {
    HeliosLoggers.auth.warn('Client authentication failed', {
        reason,
        connectionId,
        memberUuid,
        event: 'auth.failure',
    });
}

/** Log member joined. */
export function logMemberJoined(memberUuid: string, address: string, clusterName: string): void {
    HeliosLoggers.cluster.info('Member joined cluster', {
        memberUuid,
        address,
        clusterName,
        event: 'member.joined',
    });
}

/** Log member left. */
export function logMemberLeft(memberUuid: string, address: string, clusterName: string): void {
    HeliosLoggers.cluster.warn('Member left cluster', {
        memberUuid,
        address,
        clusterName,
        event: 'member.left',
    });
}

/** Log partition migration start. */
export function logPartitionMigrationStart(partitionId: number, fromMember: string, toMember: string): void {
    HeliosLoggers.partition.info('Partition migration started', {
        partitionId,
        fromMember,
        toMember,
        event: 'partition.migration.start',
    });
}

/** Log partition migration end. */
export function logPartitionMigrationEnd(partitionId: number, fromMember: string, toMember: string, success: boolean): void {
    if (success) {
        HeliosLoggers.partition.info('Partition migration completed', {
            partitionId,
            fromMember,
            toMember,
            event: 'partition.migration.end',
        });
    } else {
        HeliosLoggers.partition.warn('Partition migration failed', {
            partitionId,
            fromMember,
            toMember,
            event: 'partition.migration.failed',
        });
    }
}

/** Log routing correction (invocation sent to wrong target, retried). */
export function logRoutingCorrection(callId: number, originalTarget: string, correctedTarget: string): void {
    HeliosLoggers.invocation.debug('Routing correction: retrying on correct target', {
        callId,
        originalTarget,
        correctedTarget,
        event: 'invocation.routing.corrected',
    });
}

/** Log invocation timeout. */
export function logInvocationTimeout(callId: number, targetMember: string, timeoutMs: number): void {
    HeliosLoggers.invocation.warn('Invocation timed out', {
        callId,
        targetMember,
        timeoutMs,
        event: 'invocation.timeout',
    });
}

/** Log listener recovery attempt. */
export function logListenerRecoveryAttempt(registrationId: string, attempt: number, maxAttempts: number): void {
    HeliosLoggers.listener.info('Listener recovery attempt', {
        registrationId,
        attempt,
        maxAttempts,
        event: 'listener.recovery.attempt',
    });
}

/** Log listener recovery failure. */
export function logListenerRecoveryFailure(registrationId: string, reason: string): void {
    HeliosLoggers.listener.error('Listener recovery failed permanently', {
        registrationId,
        reason,
        event: 'listener.recovery.failed',
    });
}

/** Log connection lost. */
export function logConnectionLost(connectionId: string, memberUuid: string, reason: string): void {
    HeliosLoggers.connection.warn('Connection lost', {
        connectionId,
        memberUuid,
        reason,
        event: 'connection.lost',
    });
}

/** Log connection reconnected. */
export function logConnectionReconnected(connectionId: string, memberUuid: string): void {
    HeliosLoggers.connection.info('Connection re-established', {
        connectionId,
        memberUuid,
        event: 'connection.reconnected',
    });
}

/** Log protocol error. */
export function logProtocolError(connectionId: string, errorMessage: string, frameType?: string): void {
    HeliosLoggers.protocol.error('Protocol error on connection', {
        connectionId,
        errorMessage,
        frameType,
        event: 'protocol.error',
    });
}

/** Log near-cache reconciliation. */
export function logNearCacheReconciliation(mapName: string, invalidatedKeys: number): void {
    HeliosLoggers.nearCache.debug('Near-cache reconciliation completed', {
        mapName,
        invalidatedKeys,
        event: 'nearCache.reconciliation',
    });
}

/** Log transaction commit. */
export function logTransactionCommit(transactionId: string, durationMs: number): void {
    HeliosLoggers.transaction.info('Transaction committed', {
        transactionId,
        durationMs,
        event: 'transaction.committed',
    });
}

/** Log transaction rollback. */
export function logTransactionRollback(transactionId: string, reason: string): void {
    HeliosLoggers.transaction.warn('Transaction rolled back', {
        transactionId,
        reason,
        event: 'transaction.rolledBack',
    });
}

/** Log TLS negotiation. */
export function logTlsNegotiation(connectionId: string, protocol: string, cipherSuite: string, success: boolean): void {
    if (success) {
        HeliosLoggers.tls.info('TLS negotiation succeeded', {
            connectionId,
            protocol,
            cipherSuite,
            event: 'tls.negotiation.success',
        });
    } else {
        HeliosLoggers.tls.error('TLS negotiation failed', {
            connectionId,
            protocol,
            cipherSuite,
            event: 'tls.negotiation.failed',
        });
    }
}
