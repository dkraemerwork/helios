/**
 * Port of {@code com.hazelcast.map.impl.record.RecordReaderWriter}.
 *
 * Enum-like object used for reading/writing record instances during backup
 * and replication operations.
 */
import type { Record } from './Record';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';

export type RecordReadFn = (inp: ByteArrayObjectDataInput) => Record<unknown>;
export type RecordWriteFn = (out: ByteArrayObjectDataOutput, record: Record<unknown>, dataValue: Data) => void;

export class RecordReaderWriter {
    private static readonly _registry = new Map<number, RecordReaderWriter>();

    static readonly DATA_RECORD_WITH_STATS_READER_WRITER: RecordReaderWriter = new RecordReaderWriter(2);
    static readonly SIMPLE_DATA_RECORD_READER_WRITER: RecordReaderWriter = new RecordReaderWriter(3);
    static readonly SIMPLE_DATA_RECORD_WITH_LRU_EVICTION_READER_WRITER: RecordReaderWriter = new RecordReaderWriter(4);
    static readonly SIMPLE_DATA_RECORD_WITH_LFU_EVICTION_READER_WRITER: RecordReaderWriter = new RecordReaderWriter(5);

    private _writeFn?: RecordWriteFn;
    private _readFn?: RecordReadFn;

    private constructor(private readonly _id: number) {
        RecordReaderWriter._registry.set(_id, this);
    }

    getId(): number {
        return this._id;
    }

    writeRecord(out: ByteArrayObjectDataOutput, record: Record<unknown>, dataValue: Data): void {
        if (!this._writeFn) throw new Error(`No writeFn registered for RecordReaderWriter id=${this._id}`);
        this._writeFn(out, record, dataValue);
    }

    readRecord(inp: ByteArrayObjectDataInput): Record<unknown> {
        if (!this._readFn) throw new Error(`No readFn registered for RecordReaderWriter id=${this._id}`);
        return this._readFn(inp);
    }

    /** @internal Register write/read implementations after all record classes are defined. */
    static _register(instance: RecordReaderWriter, writeFn: RecordWriteFn, readFn: RecordReadFn): void {
        instance._writeFn = writeFn;
        instance._readFn = readFn;
    }

    static getById(id: number): RecordReaderWriter {
        const rw = RecordReaderWriter._registry.get(id);
        if (!rw) throw new Error(`Not known RecordReaderWriter type-id: ${id}`);
        return rw;
    }
}
