/**
 * Pre-registration registry for distributed task types.
 *
 * Each task type stores a factory function, an optional explicit version,
 * a fingerprint (for rollout mismatch detection), and optional pool overrides.
 *
 * @see IExecutorService.registerTaskType
 */

import { UnknownTaskTypeException, TaskRegistrationMismatchException } from '@helios/executor/ExecutorExceptions.js';

export interface TaskTypeDescriptor<T = unknown> {
    readonly taskType: string;
    readonly factory: (input: unknown) => T | Promise<T>;
    readonly fingerprint: string;
    readonly poolSize?: number;
}

export class TaskTypeRegistry {
    private readonly _descriptors = new Map<string, TaskTypeDescriptor>();

    register<T>(
        taskType: string,
        factory: (input: unknown) => T | Promise<T>,
        options?: { version?: string; poolSize?: number },
    ): void {
        const fingerprint = options?.version ?? TaskTypeRegistry._hashFactory(factory);
        const descriptor: TaskTypeDescriptor<T> = {
            taskType,
            factory,
            fingerprint,
            poolSize: options?.poolSize,
        };
        this._descriptors.set(taskType, descriptor as TaskTypeDescriptor);
    }

    get(taskType: string): TaskTypeDescriptor | undefined {
        return this._descriptors.get(taskType);
    }

    unregister(taskType: string): boolean {
        return this._descriptors.delete(taskType);
    }

    getRegisteredTypes(): ReadonlySet<string> {
        return new Set(this._descriptors.keys());
    }

    /**
     * Validate that a remote fingerprint matches the local registration.
     * @throws UnknownTaskTypeException if the task type is not registered
     * @throws TaskRegistrationMismatchException if fingerprints differ
     */
    validateFingerprint(taskType: string, remoteFingerprint: string): void {
        const desc = this._descriptors.get(taskType);
        if (!desc) {
            throw new UnknownTaskTypeException(taskType);
        }
        if (desc.fingerprint !== remoteFingerprint) {
            throw new TaskRegistrationMismatchException(taskType, desc.fingerprint, remoteFingerprint);
        }
    }

    /** Deterministic hash of factory.toString() using Bun's CryptoHasher. */
    private static _hashFactory(factory: Function): string {
        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(factory.toString());
        return hasher.digest('hex').slice(0, 16);
    }
}
