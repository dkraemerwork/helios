/**
 * Pre-registration registry for distributed task types.
 *
 * Each task type stores a factory function, an optional explicit version,
 * a fingerprint (for rollout mismatch detection), optional pool overrides,
 * and optional worker materialization metadata for distributed execution.
 *
 * @see IExecutorService.registerTaskType
 */

import { UnknownTaskTypeException, TaskRegistrationMismatchException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';

/** Worker materialization metadata — describes how a task loads inside a worker thread. */
export interface WorkerMaterializationMeta {
    /** Module path the worker will import to load the task factory. */
    readonly modulePath: string;
    /** Named export within the module (defaults to 'default'). */
    readonly exportName: string;
}

export interface TaskTypeDescriptor<T = unknown> {
    readonly taskType: string;
    readonly factory: (input: unknown) => T | Promise<T>;
    readonly fingerprint: string;
    readonly poolSize?: number;
    /** Present only for module-backed (worker-safe) registrations. */
    readonly workerMeta?: WorkerMaterializationMeta;
}

export interface TaskRegistrationOptions {
    readonly version?: string;
    readonly poolSize?: number;
    readonly modulePath?: string;
    readonly exportName?: string;
}

export class TaskTypeRegistry {
    private readonly _descriptors = new Map<string, TaskTypeDescriptor>();

    /**
     * Register a task type. Accepts optional worker materialization metadata
     * (modulePath + exportName). When provided, the metadata is included in
     * the fingerprint and the descriptor is marked worker-safe.
     */
    register<T>(
        taskType: string,
        factory: (input: unknown) => T | Promise<T>,
        options?: TaskRegistrationOptions,
    ): void {
        const workerMeta = options?.modulePath
            ? { modulePath: options.modulePath, exportName: options.exportName ?? 'default' }
            : undefined;

        const fingerprint = options?.version
            ?? TaskTypeRegistry._hashFactory(factory, workerMeta);

        const descriptor: TaskTypeDescriptor<T> = {
            taskType,
            factory,
            fingerprint,
            poolSize: options?.poolSize,
            workerMeta,
        };
        this._descriptors.set(taskType, descriptor as TaskTypeDescriptor);
    }

    /**
     * Register a task type that MUST be worker-safe (module-backed).
     * Rejects registrations without a `modulePath`.
     *
     * @throws Error if modulePath is not provided
     */
    registerDistributed<T>(
        taskType: string,
        factory: (input: unknown) => T | Promise<T>,
        options?: Omit<TaskRegistrationOptions, 'version'> & { version?: string },
    ): void {
        if (!options?.modulePath) {
            throw new Error(
                `Distributed task "${taskType}" requires a modulePath for worker-safe materialization`,
            );
        }
        this.register(taskType, factory, options);
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

    /** Returns true if the task type is registered with worker materialization metadata. */
    isWorkerSafe(taskType: string): boolean {
        const desc = this._descriptors.get(taskType);
        return desc?.workerMeta != null;
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

    /**
     * Deterministic hash of factory.toString() + optional worker metadata.
     * When worker materialization metadata is present, it is included in the
     * fingerprint so that different module paths or export names produce
     * different fingerprints.
     */
    private static _hashFactory(factory: Function, workerMeta?: WorkerMaterializationMeta): string {
        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(factory.toString());
        if (workerMeta) {
            hasher.update(`\0mod:${workerMeta.modulePath}\0exp:${workerMeta.exportName}`);
        }
        return hasher.digest('hex').slice(0, 16);
    }
}
