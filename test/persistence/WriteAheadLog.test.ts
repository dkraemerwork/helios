/**
 * Tests for the WAL (Write-Ahead Log) implementation.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { WALEntryType, WriteAheadLog } from '@zenystx/helios-core/persistence/impl/WriteAheadLog';

let tmpDir: string;
let walDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-wal-test-'));
    walDir = path.join(tmpDir, 'wal');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('WriteAheadLog', () => {
    test('open creates directory', async () => {
        const wal = new WriteAheadLog(walDir);
        await wal.open();
        expect(fs.existsSync(walDir)).toBe(true);
        wal.close();
    });

    test('append returns incrementing sequences', async () => {
        const wal = new WriteAheadLog(walDir);
        await wal.open();

        const seq1 = wal.append({ type: WALEntryType.PUT, mapName: 'test', partitionId: 0, key: new Uint8Array([1, 2]), value: new Uint8Array([3, 4]) });
        const seq2 = wal.append({ type: WALEntryType.PUT, mapName: 'test', partitionId: 0, key: new Uint8Array([5, 6]), value: new Uint8Array([7, 8]) });

        expect(seq1).toBe(1n);
        expect(seq2).toBe(2n);
        expect(wal.getCurrentSequence()).toBe(2n);

        wal.close();
    });

    test('readAll recovers appended entries', async () => {
        const wal = new WriteAheadLog(walDir);
        await wal.open();

        const key = new Uint8Array([10, 20, 30]);
        const value = new Uint8Array([40, 50, 60]);

        wal.append({ type: WALEntryType.PUT, mapName: 'myMap', partitionId: 5, key, value });
        wal.append({ type: WALEntryType.REMOVE, mapName: 'myMap', partitionId: 5, key, value: null });
        wal.close();

        const wal2 = new WriteAheadLog(walDir);
        await wal2.open();
        const entries = await wal2.readAll();
        wal2.close();

        expect(entries.length).toBe(2);

        expect(entries[0].type).toBe(WALEntryType.PUT);
        expect(entries[0].mapName).toBe('myMap');
        expect(entries[0].partitionId).toBe(5);
        expect(entries[0].sequence).toBe(1n);
        expect(Array.from(entries[0].key!)).toEqual([10, 20, 30]);
        expect(Array.from(entries[0].value!)).toEqual([40, 50, 60]);

        expect(entries[1].type).toBe(WALEntryType.REMOVE);
        expect(entries[1].key).not.toBeNull();
        expect(entries[1].value).toBeNull();
    });

    test('CLEAR entry with null key and value', async () => {
        const wal = new WriteAheadLog(walDir);
        await wal.open();

        wal.append({ type: WALEntryType.CLEAR, mapName: 'clearMap', partitionId: 0, key: null, value: null });
        wal.close();

        const wal2 = new WriteAheadLog(walDir);
        await wal2.open();
        const entries = await wal2.readAll();
        wal2.close();

        expect(entries.length).toBe(1);
        expect(entries[0].type).toBe(WALEntryType.CLEAR);
        expect(entries[0].key).toBeNull();
        expect(entries[0].value).toBeNull();
    });

    test('readAll on empty dir returns empty array', async () => {
        const wal = new WriteAheadLog(walDir);
        await wal.open();
        const entries = await wal.readAll();
        wal.close();
        expect(entries).toEqual([]);
    });

    test('segment index resumes from existing files', async () => {
        // Write first segment
        const wal1 = new WriteAheadLog(walDir);
        await wal1.open();
        wal1.append({ type: WALEntryType.PUT, mapName: 'm', partitionId: 0, key: new Uint8Array([1]), value: new Uint8Array([2]) });
        wal1.close();

        // Re-open: should find existing segment and resume
        const wal2 = new WriteAheadLog(walDir);
        await wal2.open();
        wal2.append({ type: WALEntryType.PUT, mapName: 'm', partitionId: 0, key: new Uint8Array([3]), value: new Uint8Array([4]) });
        wal2.close();

        const wal3 = new WriteAheadLog(walDir);
        await wal3.open();
        const entries = await wal3.readAll();
        wal3.close();

        expect(entries.length).toBe(2);
    });
});
