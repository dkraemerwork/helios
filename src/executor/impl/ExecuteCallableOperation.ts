/**
 * Distributed executor operation for partition-targeted task execution.
 *
 * Validates task registration + fingerprint before execution.
 * Returns a typed {@link ExecutorOperationResult} envelope.
 *
 * @see MemberCallableOperation for member-targeted variant with no-retry semantics
 */
import { Operation } from '@helios/spi/impl/operationservice/Operation.js';
import type { ExecutorOperationResult } from '@helios/executor/ExecutorOperationResult.js';
import type { TaskTypeRegistry } from '@helios/executor/impl/TaskTypeRegistry.js';
import { HeapData } from '@helios/internal/serialization/impl/HeapData.js';
import { Bits } from '@helios/internal/nio/Bits.js';
import {
    UnknownTaskTypeException,
    TaskRegistrationMismatchException,
} from '@helios/executor/ExecutorExceptions.js';

/** Wire-format descriptor sent by the executor proxy. */
export interface TaskDescriptor {
    readonly taskUuid: string;
    readonly executorName: string;
    readonly taskType: string;
    readonly registrationFingerprint: string;
    readonly inputData: Buffer;
    readonly submitterMemberUuid: string;
    readonly timeoutMillis: number;
}

export class ExecuteCallableOperation extends Operation {
    readonly descriptor: TaskDescriptor;
    private _registry: TaskTypeRegistry | null = null;
    private _originMemberUuid: string = '';

    constructor(descriptor: TaskDescriptor) {
        super();
        this.descriptor = descriptor;
        this.serviceName = 'helios:executor';
    }

    setRegistry(registry: TaskTypeRegistry): void {
        this._registry = registry;
    }

    setOriginMemberUuid(uuid: string): void {
        this._originMemberUuid = uuid;
    }

    /**
     * Whether this operation should retry on member departure.
     * Partition-targeted operations allow retry (before remote accept).
     * Member-targeted operations (MemberCallableOperation) override to return false.
     */
    shouldRetryOnMemberLeft(): boolean {
        return true;
    }

    override async run(): Promise<void> {
        const { descriptor } = this;
        const registry = this._registry;

        if (!registry) {
            this.sendResponse(this._rejectEnvelope('Error', 'No TaskTypeRegistry set on operation'));
            return;
        }

        // Validate registration + fingerprint before enqueue/execution
        try {
            registry.validateFingerprint(descriptor.taskType, descriptor.registrationFingerprint);
        } catch (e) {
            if (e instanceof UnknownTaskTypeException) {
                this.sendResponse(this._rejectEnvelope(e.name, e.message));
                return;
            }
            if (e instanceof TaskRegistrationMismatchException) {
                this.sendResponse(this._rejectEnvelope(e.name, e.message));
                return;
            }
            throw e;
        }

        // Execute the task
        const desc = registry.get(descriptor.taskType)!;
        try {
            const input = JSON.parse(descriptor.inputData.toString('utf8'));
            const result = await desc.factory(input);
            const jsonBytes = Buffer.from(JSON.stringify(result));
            const resultData = ExecuteCallableOperation._wrapAsHeapData(jsonBytes);

            const envelope: ExecutorOperationResult = {
                taskUuid: descriptor.taskUuid,
                status: 'success',
                originMemberUuid: this._originMemberUuid,
                resultData,
                errorName: null,
                errorMessage: null,
            };
            this.sendResponse(envelope);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            const envelope: ExecutorOperationResult = {
                taskUuid: descriptor.taskUuid,
                status: 'rejected',
                originMemberUuid: this._originMemberUuid,
                resultData: null,
                errorName: err.name,
                errorMessage: err.message,
            };
            this.sendResponse(envelope);
        }
    }

    /** Wrap raw payload bytes into a HeapData (8-byte header + payload). */
    private static _wrapAsHeapData(payload: Buffer): HeapData {
        const buf = Buffer.alloc(HeapData.HEAP_DATA_OVERHEAD + payload.length);
        // partition hash = 0
        Bits.writeIntB(buf, HeapData.PARTITION_HASH_OFFSET, 0);
        // type = JAVASCRIPT_JSON (-130)
        Bits.writeIntB(buf, HeapData.TYPE_OFFSET, -130);
        payload.copy(buf, HeapData.DATA_OFFSET);
        return new HeapData(buf);
    }

    private _rejectEnvelope(errorName: string, errorMessage: string): ExecutorOperationResult {
        return {
            taskUuid: this.descriptor.taskUuid,
            status: 'rejected',
            originMemberUuid: this._originMemberUuid,
            resultData: null,
            errorName,
            errorMessage,
        };
    }
}
