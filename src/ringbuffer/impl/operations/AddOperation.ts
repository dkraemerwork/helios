import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { AbstractRingBufferOperation } from '@zenystx/helios-core/ringbuffer/impl/operations/AbstractRingBufferOperation';
import { AddBackupOperation } from '@zenystx/helios-core/ringbuffer/impl/operations/AddBackupOperation';
import { OverflowPolicy } from '@zenystx/helios-core/ringbuffer/OverflowPolicy';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.operations.AddOperation}.
 *
 * Adds one item to the ringbuffer. Respects overflow policy:
 * - FAIL: returns -1 if no remaining capacity
 * - OVERWRITE: always adds (overwrites oldest item)
 *
 * Returns the sequence ID of the stored item, or -1 on FAIL overflow.
 *
 * Implements BackupAwareOperation: after a successful add, the operation
 * produces an AddBackupOperation with sync/async backup counts taken from
 * the ringbuffer config.
 */
export class AddOperation extends AbstractRingBufferOperation implements BackupAwareOperation {
    private readonly item: Data;
    private readonly overflowPolicy: OverflowPolicy;
    private resultSequence: number = -1;

    constructor(name: string, item: Data, overflowPolicy: OverflowPolicy) {
        super(name);
        this.item = item;
        this.overflowPolicy = overflowPolicy;
    }

    async run(): Promise<void> {
        const ringbuffer = this.getRingBufferContainer();

        if (this.overflowPolicy === OverflowPolicy.FAIL) {
            if (ringbuffer.remainingCapacity() < 1) {
                this.resultSequence = -1;
                return;
            }
        }

        this.resultSequence = ringbuffer.add(this.item);
    }

    shouldNotify(): boolean {
        return this.resultSequence !== -1;
    }

    shouldBackup(): boolean {
        return this.resultSequence !== -1;
    }

    getSyncBackupCount(): number {
        return this.getRingBufferContainer().getConfig().getBackupCount();
    }

    getAsyncBackupCount(): number {
        return this.getRingBufferContainer().getConfig().getAsyncBackupCount();
    }

    getBackupOperation(): Operation {
        return new AddBackupOperation(this.name, this.item);
    }

    getResponse(): number {
        return this.resultSequence;
    }
}
