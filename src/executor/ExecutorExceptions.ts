/**
 * Executor-specific exception classes.
 * Each has a distinct `name` for wire-level error identification.
 */

export class UnknownTaskTypeException extends Error {
    constructor(taskType: string) {
        super(`Unknown task type: "${taskType}" is not registered on this member`);
        this.name = 'UnknownTaskTypeException';
    }
}

export class TaskRegistrationMismatchException extends Error {
    constructor(taskType: string, localFingerprint: string, remoteFingerprint: string) {
        super(
            `Task type "${taskType}" registration mismatch: ` +
            `local fingerprint "${localFingerprint}" !== remote fingerprint "${remoteFingerprint}"`,
        );
        this.name = 'TaskRegistrationMismatchException';
    }
}

export class ExecutorRejectedExecutionException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExecutorRejectedExecutionException';
    }
}

export class ExecutorTaskLostException extends Error {
    constructor(taskUuid: string, reason: string) {
        super(`Task "${taskUuid}" lost: ${reason}`);
        this.name = 'ExecutorTaskLostException';
    }
}

export class ExecutorTaskTimeoutException extends Error {
    constructor(taskUuid: string, timeoutMillis: number) {
        super(`Task "${taskUuid}" timed out after ${timeoutMillis}ms`);
        this.name = 'ExecutorTaskTimeoutException';
    }
}
