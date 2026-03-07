import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { AbstractRingBufferOperation } from '@zenystx/helios-core/ringbuffer/impl/operations/AbstractRingBufferOperation';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.operations.AddBackupOperation}.
 *
 * Backup operation that replays a single item add on the backup ringbuffer container.
 */
export class AddBackupOperation extends AbstractRingBufferOperation {
    private readonly item: Data;

    constructor(name: string, item: Data) {
        super(name);
        this.item = item;
    }

    async run(): Promise<void> {
        const ringbuffer = this.getRingBufferContainer();
        ringbuffer.add(this.item);
    }
}
