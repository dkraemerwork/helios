/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.BatchInvalidator}.
 *
 * Sends invalidations to Near Caches in batches.
 */
import { Invalidator } from '@zenystx/core/internal/nearcache/impl/invalidation/Invalidator';
import { InvalidationQueue } from '@zenystx/core/internal/nearcache/impl/invalidation/InvalidationQueue';
import { BatchNearCacheInvalidation } from '@zenystx/core/internal/nearcache/impl/invalidation/BatchNearCacheInvalidation';
import type { Invalidation } from '@zenystx/core/internal/nearcache/impl/invalidation/Invalidation';
import type { Data } from '@zenystx/core/internal/serialization/Data';
import type { EventFilter, InvalidatorNodeEngine } from '@zenystx/core/internal/nearcache/impl/invalidation/Invalidator';

export interface BatchInvalidatorNodeEngine extends InvalidatorNodeEngine {
    getExecutionService(): {
        scheduleWithRepetition(
            name: string,
            task: () => void,
            initialDelay: number,
            period: number,
        ): void;
        shutdownExecutor(name: string): void;
    };
    getHeliosInstance(): {
        getLifecycleService(): {
            addLifecycleListener(fn: (event: { state: string }) => void): string;
            removeLifecycleListener(id: string): void;
        };
    };
}

export class BatchInvalidator extends Invalidator {
    private readonly _batchSize: number;
    private readonly _batchFrequencySeconds: number;
    private readonly _invalidationQueues = new Map<string, InvalidationQueue<Invalidation>>();
    private readonly _invalidationExecutorName: string;
    private readonly _batchNodeEngine: BatchInvalidatorNodeEngine;
    private _nodeShutdownListenerId: string | null = null;
    private _backgroundTaskRunning = false;

    constructor(
        serviceName: string,
        batchSize: number,
        batchFrequencySeconds: number,
        eventFilter: EventFilter,
        nodeEngine: BatchInvalidatorNodeEngine,
    ) {
        super(serviceName, eventFilter, nodeEngine);
        this._batchNodeEngine = nodeEngine;
        this._batchSize = batchSize;
        this._batchFrequencySeconds = batchFrequencySeconds;
        this._invalidationExecutorName = serviceName + 'BatchInvalidator';
        this._nodeShutdownListenerId = this._registerNodeShutdownListener();
    }

    protected override newInvalidation(
        key: Data | null,
        dataStructureName: string,
        sourceUuid: string | null,
        partitionId: number,
    ) {
        if (key !== null) {
            this._checkBackgroundTaskIsRunning();
        }
        return super.newInvalidation(key, dataStructureName, sourceUuid, partitionId);
    }

    protected override invalidateInternal(invalidation: Invalidation, _orderKey: number): void {
        const dataStructureName = invalidation.getName();
        const queue = this._invalidationQueueOf(dataStructureName);
        queue.offer(invalidation);

        if (queue.size() >= this._batchSize) {
            this._pollAndSendInvalidations(dataStructureName, queue);
        }
    }

    private _invalidationQueueOf(name: string): InvalidationQueue<Invalidation> {
        let queue = this._invalidationQueues.get(name);
        if (!queue) {
            queue = new InvalidationQueue<Invalidation>();
            this._invalidationQueues.set(name, queue);
        }
        return queue;
    }

    private _pollAndSendInvalidations(
        dataStructureName: string,
        queue: InvalidationQueue<Invalidation>,
    ): void {
        if (!queue.tryAcquire()) return;
        let invalidations: Invalidation[];
        try {
            invalidations = this._pollInvalidations(queue);
        } finally {
            queue.release();
        }
        this._sendInvalidations(dataStructureName, invalidations);
    }

    private _pollInvalidations(queue: InvalidationQueue<Invalidation>): Invalidation[] {
        const size = queue.size();
        const result: Invalidation[] = [];
        for (let i = 0; i < size; i++) {
            const inv = queue.poll();
            if (inv === null) break;
            result.push(inv);
        }
        return result;
    }

    private _sendInvalidations(dataStructureName: string, invalidations: Invalidation[]): void {
        if (invalidations.length === 0) return;
        const batchInvalidation = new BatchNearCacheInvalidation(dataStructureName, invalidations);
        const registrations = this.eventService.getRegistrations(this.serviceName, dataStructureName);
        for (const registration of registrations) {
            if (this.eventFilter(registration)) {
                const orderKey = registration.getId().split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
                this.eventService.publishEvent(this.serviceName, registration, batchInvalidation, orderKey);
            }
        }
    }

    private _registerNodeShutdownListener(): string {
        const instance = this._batchNodeEngine.getHeliosInstance();
        const lifecycleService = instance.getLifecycleService();
        return lifecycleService.addLifecycleListener((event) => {
            if (event.state === 'SHUTTING_DOWN') {
                for (const [name, queue] of this._invalidationQueues) {
                    this._pollAndSendInvalidations(name, queue);
                }
            }
        });
    }

    private _checkBackgroundTaskIsRunning(): void {
        if (this._backgroundTaskRunning) return;
        this._backgroundTaskRunning = true;
        const executionService = this._batchNodeEngine.getExecutionService();
        executionService.scheduleWithRepetition(
            this._invalidationExecutorName,
            () => {
                for (const [name, queue] of this._invalidationQueues) {
                    if (!queue.isEmpty()) {
                        this._pollAndSendInvalidations(name, queue);
                    }
                }
            },
            this._batchFrequencySeconds,
            this._batchFrequencySeconds,
        );
    }

    override destroy(dataStructureName: string, sourceUuid: string): void {
        this._invalidationQueues.delete(dataStructureName);
        super.destroy(dataStructureName, sourceUuid);
    }

    override shutdown(): void {
        const executionService = this._batchNodeEngine.getExecutionService();
        executionService.shutdownExecutor(this._invalidationExecutorName);

        if (this._nodeShutdownListenerId !== null) {
            this._batchNodeEngine.getHeliosInstance()
                .getLifecycleService()
                .removeLifecycleListener(this._nodeShutdownListenerId);
        }

        this._invalidationQueues.clear();
        super.shutdown();
    }

    override reset(): void {
        this._invalidationQueues.clear();
        super.reset();
    }
}
