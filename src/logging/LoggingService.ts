/**
 * Central factory for named loggers throughout Helios.
 *
 * Maintains a registry of {@link HeliosLogger} instances so that the same
 * logical component always gets the same logger object.  All loggers inherit
 * the service's default level at creation time; the level can later be changed
 * per-logger or globally.
 */

import { HeliosLogger } from '@zenystx/helios-core/logging/HeliosLogger.js';
import { ILogger, LogLevel } from '@zenystx/helios-core/logging/Logger.js';

export class LoggingService {
    private readonly _loggers: Map<string, HeliosLogger> = new Map();
    private _defaultLevel: LogLevel;

    constructor(defaultLevel: LogLevel = LogLevel.INFO) {
        this._defaultLevel = defaultLevel;
    }

    /**
     * Return the named logger, creating it with the current default level if
     * it does not already exist.
     */
    getLogger(name: string): ILogger {
        let logger = this._loggers.get(name);
        if (logger === undefined) {
            logger = new HeliosLogger(name, this._defaultLevel);
            this._loggers.set(name, logger);
        }
        return logger;
    }

    /**
     * Change the default level AND apply it to every logger already created.
     * Useful for runtime log-level changes (e.g. debug mode toggle).
     */
    setLevel(level: LogLevel): void {
        this._defaultLevel = level;
        for (const logger of this._loggers.values()) {
            logger.setLevel(level);
        }
    }

    /** Current default level applied to new loggers. */
    getDefaultLevel(): LogLevel { return this._defaultLevel; }
}
