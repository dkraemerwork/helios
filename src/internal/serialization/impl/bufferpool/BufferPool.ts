/**
 * Port of {@code com.hazelcast.internal.serialization.impl.bufferpool.BufferPoolImpl}.
 *
 * Simple free-list buffer pool (max 3 items). No synchronization needed —
 * Bun is single-threaded and each Worker gets its own JS heap.
 */
import { ByteArrayObjectDataOutput } from '@zenystx/core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { ByteArrayObjectDataInput } from '@zenystx/core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { InternalSerializationService } from '@zenystx/core/internal/serialization/InternalSerializationService';
import type { ByteOrder } from '@zenystx/core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { Data } from '@zenystx/core/internal/serialization/Data';
import { HeapData } from '@zenystx/core/internal/serialization/impl/HeapData';

const MAX_POOLED_ITEMS = 3;
const DEFAULT_OUTPUT_SIZE = 4096;

export class BufferPool {
    private readonly outputPool: ByteArrayObjectDataOutput[] = [];
    private readonly inputPool: ByteArrayObjectDataInput[] = [];
    private readonly service: InternalSerializationService;
    private readonly byteOrder: ByteOrder;

    constructor(service: InternalSerializationService, byteOrder: ByteOrder) {
        this.service = service;
        this.byteOrder = byteOrder;
    }

    takeOutputBuffer(): ByteArrayObjectDataOutput {
        const out = this.outputPool.pop();
        if (out) return out;
        return new ByteArrayObjectDataOutput(DEFAULT_OUTPUT_SIZE, this.service, this.byteOrder);
    }

    returnOutputBuffer(out: ByteArrayObjectDataOutput): void {
        if (out == null) return;
        out.clear();
        if (this.outputPool.length < MAX_POOLED_ITEMS) {
            this.outputPool.push(out);
        }
    }

    takeInputBuffer(data: Data): ByteArrayObjectDataInput {
        const inp = this.inputPool.pop();
        if (inp) {
            inp.init(data.toByteArray(), HeapData.DATA_OFFSET);
            return inp;
        }
        return new ByteArrayObjectDataInput(
            data.toByteArray(), HeapData.DATA_OFFSET, this.service, this.byteOrder,
        );
    }

    returnInputBuffer(inp: ByteArrayObjectDataInput): void {
        if (inp == null) return;
        inp.clear();
        if (this.inputPool.length < MAX_POOLED_ITEMS) {
            this.inputPool.push(inp);
        }
    }

    /** N19 FIX: drain all pooled buffers on service shutdown. */
    clear(): void {
        this.outputPool.length = 0;
        this.inputPool.length = 0;
    }
}
