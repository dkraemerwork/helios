/**
 * Minimal port of {@code com.hazelcast.logging.ILogger}.
 *
 * Only the subset needed for test-support stubs. Block 3.1 will extend this
 * with the full logging interface.
 */
export interface ILogger {
    finest(msg: string, err?: unknown): void;
    fine(msg: string, err?: unknown): void;
    info(msg: string, err?: unknown): void;
    warning(msg: string, err?: unknown): void;
    severe(msg: string, err?: unknown): void;
    isFinestEnabled(): boolean;
    isFineEnabled(): boolean;
}

/**
 * Console-based ILogger implementation for tests.
 */
export class ConsoleLogger implements ILogger {
    constructor(private readonly name: string) {}

    finest(msg: string, err?: unknown): void {
        if (err !== undefined) console.debug(`[FINEST][${this.name}] ${msg}`, err);
        else console.debug(`[FINEST][${this.name}] ${msg}`);
    }

    fine(msg: string, err?: unknown): void {
        if (err !== undefined) console.debug(`[FINE][${this.name}] ${msg}`, err);
        else console.debug(`[FINE][${this.name}] ${msg}`);
    }

    info(msg: string, err?: unknown): void {
        if (err !== undefined) console.info(`[INFO][${this.name}] ${msg}`, err);
        else console.info(`[INFO][${this.name}] ${msg}`);
    }

    warning(msg: string, err?: unknown): void {
        if (err !== undefined) console.warn(`[WARN][${this.name}] ${msg}`, err);
        else console.warn(`[WARN][${this.name}] ${msg}`);
    }

    severe(msg: string, err?: unknown): void {
        if (err !== undefined) console.error(`[SEVERE][${this.name}] ${msg}`, err);
        else console.error(`[SEVERE][${this.name}] ${msg}`);
    }

    isFinestEnabled(): boolean { return false; }
    isFineEnabled(): boolean { return false; }
}
