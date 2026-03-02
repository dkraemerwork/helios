/**
 * Port of {@code com.hazelcast.map.impl.record.SimpleRecordWithLFUEviction}.
 */
import { SimpleRecord } from './SimpleRecord';
import { RecordReaderWriter } from './RecordReaderWriter';

export class SimpleRecordWithLFUEviction extends SimpleRecord {
    private _hits = 0;

    override getHits(): number { return this._hits; }
    override setHits(hits: number): void { this._hits = hits; }
    override incrementHits(): void {
        if (this._hits < 2147483647) this._hits++;
    }

    override onAccess(now: number): void {
        this.incrementHits();
        this.setLastAccessTime(now);
    }

    override getMatchingRecordReaderWriter(): RecordReaderWriter {
        return RecordReaderWriter.SIMPLE_DATA_RECORD_WITH_LFU_EVICTION_READER_WRITER;
    }
}
