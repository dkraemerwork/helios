/**
 * Distributed executor operation for partition-targeted task execution.
 *
 * Validates task registration + fingerprint before delegating to
 * {@link ExecutorContainerService} for bounded execution.
 * Rejects if no container is registered — no fallback to direct factory execution.
 *
 * @see MemberCallableOperation for member-targeted variant with no-retry semantics
 */
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';
import type { ExecutorOperationResult } from '@zenystx/helios-core/executor/ExecutorOperationResult.js';
import type { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import type { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData.js';
import { Bits } from '@zenystx/helios-core/internal/nio/Bits.js';
import {
    UnknownTaskTypeException,
    TaskRegistrationMismatchException,
} from '@zenystx/helios-core/executor/ExecutorExceptions.js';

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
    private _containerService: ExecutorContainerService | null = null;
    private _originMemberUuid: string = '';

    constructor(descriptor: TaskDescriptor) {
        super();
        this.descriptor = descriptor;
        this.serviceName = 'helios:executor';
    }

    setRegistry(registry: TaskTypeRegistry): void {
        this._registry = registry;
    }

    setContainerService(container: ExecutorContainerService): void {
        this._containerService = container;
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

        // Auto-resolve registry and container from NodeEngine service registry
        // if not explicitly set (production path: operation handler injects these).
        if (!this._registry) {
            const ne = this.getNodeEngine();
            if (ne) {
                const containerKey = `helios:executor:container:${descriptor.executorName}`;
                const container = ne.getServiceOrNull<ExecutorContainerService>(containerKey);
                if (container) this._containerService = container;

                const registryKey = `helios:executor:registry:${descriptor.executorName}`;
                const reg = ne.getServiceOrNull<TaskTypeRegistry>(registryKey);
                if (reg) this._registry = reg;
            }
        }

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

        // Container is required — no fallback to direct factory execution.
        if (!this._containerService) {
            this.sendResponse(this._rejectEnvelope(
                'ExecutorRejectedExecutionException',
                `No ExecutorContainerService registered for executor "${descriptor.executorName}"`,
            ));
            return;
        }

        const result = await this._containerService.executeTask({
            taskUuid: descriptor.taskUuid,
            taskType: descriptor.taskType,
            registrationFingerprint: descriptor.registrationFingerprint,
            inputData: descriptor.inputData,
            executorName: descriptor.executorName,
            submitterMemberUuid: descriptor.submitterMemberUuid,
            timeoutMillis: descriptor.timeoutMillis,
        });
        this.sendResponse(result);
    }

    /** Wrap raw payload bytes into HeapData with 4-byte length prefix. */
    static _wrapAsHeapData(payload: Buffer): HeapData {
        const buf = Buffer.alloc(HeapData.HEAP_DATA_OVERHEAD + 4 + payload.length);
        Bits.writeIntB(buf, HeapData.PARTITION_HASH_OFFSET, 0);
        Bits.writeIntB(buf, HeapData.TYPE_OFFSET, -130);
        Bits.writeIntB(buf, HeapData.DATA_OFFSET, payload.length);
        payload.copy(buf, HeapData.DATA_OFFSET + 4);
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
