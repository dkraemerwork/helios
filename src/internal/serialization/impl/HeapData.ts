/**
 * Port of {@code com.hazelcast.internal.serialization.impl.HeapData}.
 *
 * A {@link Data} implementation where the content lives on the heap (Buffer).
 */
import type { Data } from '@helios/internal/serialization/Data';
import { Bits } from '@helios/internal/nio/Bits';
import { HashUtil } from '@helios/internal/util/HashUtil';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export class HeapData implements Data {
    static readonly PARTITION_HASH_OFFSET = 0;
    static readonly TYPE_OFFSET = 4;
    static readonly DATA_OFFSET = 8;
    static readonly HEAP_DATA_OVERHEAD = HeapData.DATA_OFFSET;

    protected payload: Buffer | null;

    constructor(payload?: Buffer | null) {
        if (payload == null) {
            this.payload = payload ?? null;
            return;
        }
        if (payload.length > 0 && payload.length < HeapData.HEAP_DATA_OVERHEAD) {
            throw new Error(
                `Data should be either empty or contain more than ${HeapData.HEAP_DATA_OVERHEAD} bytes! -> [${Array.from(payload)}]`
            );
        }
        this.payload = payload;
    }

    dataSize(): number {
        return Math.max(this.totalSize() - HeapData.HEAP_DATA_OVERHEAD, 0);
    }

    totalSize(): number {
        return this.payload != null ? this.payload.length : 0;
    }

    copyTo(dest: Buffer, destPos: number): void {
        if (this.totalSize() > 0 && this.payload != null) {
            this.payload.copy(dest, destPos);
        }
    }

    getPartitionHash(): number {
        if (this.hasPartitionHash() && this.payload != null) {
            return Bits.readIntB(this.payload, HeapData.PARTITION_HASH_OFFSET);
        }
        return this.hashCode();
    }

    hasPartitionHash(): boolean {
        return this.payload != null
            && this.payload.length >= HeapData.HEAP_DATA_OVERHEAD
            && Bits.readIntB(this.payload, HeapData.PARTITION_HASH_OFFSET) !== 0;
    }

    toByteArray(): Buffer | null {
        return this.payload;
    }

    getType(): number {
        if (this.totalSize() === 0) {
            return SerializationConstants.CONSTANT_TYPE_NULL;
        }
        return Bits.readIntB(this.payload!, HeapData.TYPE_OFFSET);
    }

    getHeapCost(): number {
        // Approximate: object overhead + reference + array header + payload
        return 16 + 8 + (this.payload != null ? 16 + this.payload.length : 0);
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (other == null) return false;
        if (typeof other !== 'object') return false;
        const data = other as Data;
        if (typeof data.getType !== 'function') return false;
        if (this.getType() !== data.getType()) return false;
        const dataSize = this.dataSize();
        if (dataSize !== data.dataSize()) return false;
        if (dataSize === 0) return true;
        const otherBytes = data.toByteArray();
        return HeapData._equals(this.payload, otherBytes);
    }

    private static _equals(data1: Buffer | null | undefined, data2: Buffer | null | undefined): boolean {
        if (data1 === data2) return true;
        if (data1 == null || data2 == null) return false;
        if (data1.length !== data2.length) return false;
        for (let i = data1.length - 1; i >= HeapData.DATA_OFFSET; i--) {
            if (data1[i] !== data2[i]) return false;
        }
        return true;
    }

    hashCode(): number {
        if (this.payload == null) return 0;
        return HashUtil.MurmurHash3_x86_32(this.payload, HeapData.DATA_OFFSET, this.dataSize());
    }

    hash64(): bigint {
        if (this.payload == null) return 0n;
        return HashUtil.MurmurHash3_x64_64(this.payload, HeapData.DATA_OFFSET, this.dataSize());
    }

    isPortable(): boolean {
        return SerializationConstants.CONSTANT_TYPE_PORTABLE === this.getType();
    }

    isJson(): boolean {
        return SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE === this.getType();
    }

    isCompact(): boolean {
        return SerializationConstants.TYPE_COMPACT === this.getType();
    }

    toString(): string {
        return `HeapData{type=${this.getType()}, hashCode=${this.hashCode()}, partitionHash=${this.getPartitionHash()}, totalSize=${this.totalSize()}, dataSize=${this.dataSize()}, heapCost=${this.getHeapCost()}}`;
    }
}
