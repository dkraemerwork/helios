/**
 * Port of {@code com.hazelcast.map.impl.record.SimpleRecordWithLRUEviction}.
 */
import { recomputeWithBaseTime, stripBaseTime } from '@zenystx/helios-core/internal/util/TimeStripUtil';
import { RecordReaderWriter } from './RecordReaderWriter';
import { SimpleRecord } from './SimpleRecord';

export class SimpleRecordWithLRUEviction extends SimpleRecord {
    private _lastAccessTime = -1;

    override getLastAccessTime(): number { return recomputeWithBaseTime(this._lastAccessTime); }
    override setLastAccessTime(t: number): void { this._lastAccessTime = stripBaseTime(t); }
    override getRawLastAccessTime(): number { return this._lastAccessTime; }
    override setRawLastAccessTime(t: number): void { this._lastAccessTime = t; }

    override onAccess(now: number): void {
        this.setLastAccessTime(now);
    }

    override getMatchingRecordReaderWriter(): RecordReaderWriter {
        return RecordReaderWriter.SIMPLE_DATA_RECORD_WITH_LRU_EVICTION_READER_WRITER;
    }
}
