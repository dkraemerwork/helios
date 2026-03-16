/**
 * Production ILogger implementation for Helios.
 *
 * Features:
 *  - Level-based filtering: messages below the configured level are dropped.
 *  - Structured prefix: [LEVEL] [ISO-timestamp] [name] message
 *  - Routes to appropriate console method per level severity.
 *  - Thread-safe by design (Bun is single-threaded).
 */

import { ILogger, LogLevel } from '@zenystx/helios-core/logging/Logger.js';

/** Maps LogLevel to a short, fixed-width label used in log prefixes. */
const LEVEL_LABELS: ReadonlyMap<LogLevel, string> = new Map([
    [LogLevel.SEVERE,  'SEVERE '],
    [LogLevel.WARNING, 'WARNING'],
    [LogLevel.INFO,    'INFO   '],
    [LogLevel.CONFIG,  'CONFIG '],
    [LogLevel.FINE,    'FINE   '],
    [LogLevel.FINER,   'FINER  '],
    [LogLevel.FINEST,  'FINEST '],
]);

export class HeliosLogger implements ILogger {
    private readonly _name: string;
    private _level: LogLevel;

    constructor(name: string, level: LogLevel = LogLevel.INFO) {
        this._name = name;
        this._level = level;
    }

    // ── ILogger ───────────────────────────────────────────────────────────────

    severe(...args: unknown[]): void  { this.log(LogLevel.SEVERE,  ...args); }
    warning(...args: unknown[]): void { this.log(LogLevel.WARNING, ...args); }
    info(...args: unknown[]): void    { this.log(LogLevel.INFO,    ...args); }
    config(...args: unknown[]): void  { this.log(LogLevel.CONFIG,  ...args); }
    fine(...args: unknown[]): void    { this.log(LogLevel.FINE,    ...args); }
    finer(...args: unknown[]): void   { this.log(LogLevel.FINER,   ...args); }
    finest(...args: unknown[]): void  { this.log(LogLevel.FINEST,  ...args); }

    log(level: LogLevel, ...args: unknown[]): void {
        if (!this.isLoggable(level)) return;

        const label  = LEVEL_LABELS.get(level) ?? 'UNKNOWN';
        const ts     = new Date().toISOString();
        const prefix = `[${label}] [${ts}] [${this._name}]`;

        this._emit(level, prefix, args);
    }

    isLoggable(level: LogLevel): boolean {
        return level !== LogLevel.OFF && this._level >= level;
    }

    isFineEnabled(): boolean   { return this._level >= LogLevel.FINE;   }
    isFinestEnabled(): boolean { return this._level >= LogLevel.FINEST; }

    getLevel(): LogLevel             { return this._level;  }
    setLevel(level: LogLevel): void  { this._level = level; }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _emit(level: LogLevel, prefix: string, args: unknown[]): void {
        if (level <= LogLevel.SEVERE) {
            console.error(prefix, ...args);
        } else if (level <= LogLevel.WARNING) {
            console.warn(prefix, ...args);
        } else if (level <= LogLevel.INFO) {
            console.info(prefix, ...args);
        } else {
            console.debug(prefix, ...args);
        }
    }
}
