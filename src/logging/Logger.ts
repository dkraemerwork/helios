/**
 * Production logging interface for Helios — mirrors {@code com.hazelcast.logging.ILogger}.
 *
 * Numeric levels match Java's {@code java.util.logging.Level} ordinals so they
 * can be compared with simple integer arithmetic:
 *   isLoggable(level) ≡ this.getLevel() >= level
 */

export enum LogLevel {
    OFF     = 0,
    SEVERE  = 100,
    WARNING = 200,
    INFO    = 300,
    CONFIG  = 400,
    FINE    = 500,
    FINER   = 600,
    FINEST  = 700,
    ALL     = 800,
}

export interface ILogger {
    severe(...args: unknown[]): void;
    warning(...args: unknown[]): void;
    info(...args: unknown[]): void;
    config(...args: unknown[]): void;
    fine(...args: unknown[]): void;
    finer(...args: unknown[]): void;
    finest(...args: unknown[]): void;
    log(level: LogLevel, ...args: unknown[]): void;
    isLoggable(level: LogLevel): boolean;
    isFineEnabled(): boolean;
    isFinestEnabled(): boolean;
    getLevel(): LogLevel;
    setLevel(level: LogLevel): void;
}
