/**
 * Backwards-compatible test-support logger shim.
 *
 * Production code should import from `@zenystx/helios-core/logging/Logger.js`.
 * This file re-exports the production {@link ILogger} interface so that test
 * code referencing `test-support/ILogger` continues to compile without change.
 *
 * {@link ConsoleLogger} is kept here as a convenience logger for unit tests
 * that do not need level filtering.  It maps the extended ILogger interface to
 * the simple console.* methods.
 */

export type { ILogger } from '@zenystx/helios-core/logging/Logger.js';
export { LogLevel } from '@zenystx/helios-core/logging/Logger.js';

import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';
import { LogLevel } from '@zenystx/helios-core/logging/Logger.js';

/**
 * Console-based ILogger implementation for tests.
 *
 * Logs all levels (no filtering).  Not suitable for production use.
 */
export class ConsoleLogger implements ILogger {
    constructor(private readonly name: string) {}

    severe(...args: unknown[]): void  { console.error(`[SEVERE ][${this.name}]`,  ...args); }
    warning(...args: unknown[]): void { console.warn( `[WARNING][${this.name}]`,  ...args); }
    info(...args: unknown[]): void    { console.info( `[INFO   ][${this.name}]`,  ...args); }
    config(...args: unknown[]): void  { console.info( `[CONFIG ][${this.name}]`,  ...args); }
    fine(...args: unknown[]): void    { console.debug(`[FINE   ][${this.name}]`,  ...args); }
    finer(...args: unknown[]): void   { console.debug(`[FINER  ][${this.name}]`,  ...args); }
    finest(...args: unknown[]): void  { console.debug(`[FINEST ][${this.name}]`,  ...args); }

    log(level: LogLevel, ...args: unknown[]): void {
        switch (level) {
            case LogLevel.SEVERE:  this.severe(...args);  break;
            case LogLevel.WARNING: this.warning(...args); break;
            case LogLevel.INFO:    this.info(...args);    break;
            case LogLevel.CONFIG:  this.config(...args);  break;
            case LogLevel.FINE:    this.fine(...args);    break;
            case LogLevel.FINER:   this.finer(...args);   break;
            case LogLevel.FINEST:  this.finest(...args);  break;
            default: break;
        }
    }

    isLoggable(_level: LogLevel): boolean { return true; }
    isFineEnabled(): boolean   { return true; }
    isFinestEnabled(): boolean { return true; }
    getLevel(): LogLevel       { return LogLevel.ALL; }
    setLevel(_level: LogLevel): void { /* no-op in test logger */ }
}
