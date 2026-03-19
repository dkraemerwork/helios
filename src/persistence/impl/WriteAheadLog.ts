/**
 * Write-Ahead Log for recording mutations before they are committed to memory.
 * Uses an append-only binary file on disk.
 */
import * as fs from 'fs';
import * as path from 'path';

export enum WALEntryType {
    PUT = 1,
    REMOVE = 2,
    CLEAR = 3,
    // Queue operations
    OFFER = 4,
    POLL = 5,
    // Ringbuffer operations
    ADD = 6,
    // Checkpoint markers
    CHECKPOINT_START = 10,
    CHECKPOINT_END = 11,
}

export interface WALEntry {
    readonly type: WALEntryType;
    readonly sequence: bigint;
    readonly timestamp: number;
    readonly mapName: string;
    readonly partitionId: number;
    readonly key: Uint8Array | null;
    readonly value: Uint8Array | null;
}

export class WriteAheadLog {
    private readonly _dir: string;
    private readonly _maxSegmentSize: number;
    private _currentSequence: bigint = 0n;
    private _fd: number | null = null;
    private _segmentIndex = 0;
    private _currentSegmentSize = 0;

    constructor(dir: string, maxSegmentSize: number = 64 * 1024 * 1024) {
        this._dir = dir;
        this._maxSegmentSize = maxSegmentSize;
    }

    async open(): Promise<void> {
        await fs.promises.mkdir(this._dir, { recursive: true });
        // Find the latest segment
        const files = await fs.promises.readdir(this._dir);
        const walFiles = files.filter(f => f.startsWith('wal-') && f.endsWith('.log')).sort();
        if (walFiles.length > 0) {
            const lastFile = walFiles[walFiles.length - 1];
            const match = lastFile.match(/wal-(\d+)\.log/);
            if (match) {
                this._segmentIndex = parseInt(match[1], 10);
            }
        }
        this._openSegment();
    }

    private _openSegment(): void {
        const filePath = path.join(this._dir, `wal-${String(this._segmentIndex).padStart(8, '0')}.log`);
        this._fd = fs.openSync(filePath, 'a');
        const stat = fs.fstatSync(this._fd);
        this._currentSegmentSize = stat.size;
    }

    private _rotateIfNeeded(): void {
        if (this._currentSegmentSize >= this._maxSegmentSize) {
            if (this._fd !== null) fs.closeSync(this._fd);
            this._segmentIndex++;
            this._openSegment();
        }
    }

    append(entry: Omit<WALEntry, 'sequence' | 'timestamp'>): bigint {
        this._rotateIfNeeded();
        this._currentSequence++;
        const seq = this._currentSequence;
        const timestamp = Date.now();

        // Binary format: type(1) + seq(8) + ts(8) + mapNameLen(4) + mapName + partitionId(4) + keyLen(4) + key + valueLen(4) + value
        const mapNameBytes = Buffer.from(entry.mapName, 'utf-8');
        const keyBytes = entry.key ?? new Uint8Array(0);
        const valueBytes = entry.value ?? new Uint8Array(0);

        const totalSize = 1 + 8 + 8 + 4 + mapNameBytes.length + 4 + 4 + keyBytes.length + 4 + valueBytes.length;
        const buffer = Buffer.alloc(4 + totalSize); // 4 bytes for total size prefix
        let offset = 0;

        buffer.writeUInt32BE(totalSize, offset); offset += 4;
        buffer.writeUInt8(entry.type, offset); offset += 1;
        buffer.writeBigInt64BE(seq, offset); offset += 8;
        buffer.writeBigInt64BE(BigInt(timestamp), offset); offset += 8;
        buffer.writeUInt32BE(mapNameBytes.length, offset); offset += 4;
        mapNameBytes.copy(buffer, offset); offset += mapNameBytes.length;
        buffer.writeInt32BE(entry.partitionId, offset); offset += 4;
        buffer.writeUInt32BE(keyBytes.length, offset); offset += 4;
        Buffer.from(keyBytes).copy(buffer, offset); offset += keyBytes.length;
        buffer.writeUInt32BE(valueBytes.length, offset); offset += 4;
        Buffer.from(valueBytes).copy(buffer, offset);

        if (this._fd !== null) {
            fs.writeSync(this._fd, buffer);
            this._currentSegmentSize += buffer.length;
        }

        return seq;
    }

    /** Read all entries from all WAL segments. */
    async readAll(): Promise<WALEntry[]> {
        const entries: WALEntry[] = [];
        const files = await fs.promises.readdir(this._dir);
        const walFiles = files.filter(f => f.startsWith('wal-') && f.endsWith('.log')).sort();

        for (const file of walFiles) {
            const filePath = path.join(this._dir, file);
            const data = await fs.promises.readFile(filePath);
            let offset = 0;

            while (offset < data.length) {
                if (offset + 4 > data.length) break;
                const totalSize = data.readUInt32BE(offset); offset += 4;
                if (offset + totalSize > data.length) break;

                const type = data.readUInt8(offset) as WALEntryType; offset += 1;
                const sequence = data.readBigInt64BE(offset); offset += 8;
                const timestamp = Number(data.readBigInt64BE(offset)); offset += 8;
                const mapNameLen = data.readUInt32BE(offset); offset += 4;
                const mapName = data.subarray(offset, offset + mapNameLen).toString('utf-8'); offset += mapNameLen;
                const partitionId = data.readInt32BE(offset); offset += 4;
                const keyLen = data.readUInt32BE(offset); offset += 4;
                const key = keyLen > 0 ? new Uint8Array(data.subarray(offset, offset + keyLen)) : null; offset += keyLen;
                const valueLen = data.readUInt32BE(offset); offset += 4;
                const value = valueLen > 0 ? new Uint8Array(data.subarray(offset, offset + valueLen)) : null; offset += valueLen;

                entries.push({ type, sequence, timestamp, mapName, partitionId, key, value });
            }
        }

        return entries;
    }

    /** Fsync and close. */
    close(): void {
        if (this._fd !== null) {
            fs.fsyncSync(this._fd);
            fs.closeSync(this._fd);
            this._fd = null;
        }
    }

    /** Remove all WAL segments where every entry has a sequence less than the given sequence. */
    async truncateBefore(sequence: bigint): Promise<void> {
        const files = await fs.promises.readdir(this._dir);
        const walFiles = files
            .filter(f => f.startsWith('wal-') && f.endsWith('.log'))
            .sort();

        // Never delete the current (last) segment — it may still be open for appending.
        const deletionCandidates = walFiles.slice(0, -1);

        for (const file of deletionCandidates) {
            const filePath = path.join(this._dir, file);
            const data = await fs.promises.readFile(filePath);
            let offset = 0;
            let allBefore = true;

            while (offset < data.length) {
                if (offset + 4 > data.length) break;
                const totalSize = data.readUInt32BE(offset); offset += 4;
                if (offset + totalSize > data.length) break;

                // sequence is at bytes [1..8] within the entry (after 1-byte type)
                const entrySeq = data.readBigInt64BE(offset + 1);
                if (entrySeq >= sequence) {
                    allBefore = false;
                    break;
                }
                offset += totalSize;
            }

            if (allBefore) {
                await fs.promises.unlink(filePath);
            }
        }
    }

    getCurrentSequence(): bigint { return this._currentSequence; }
    getDir(): string { return this._dir; }
}
