/**
 * Tests for the Checkpoint (snapshot) implementation.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Checkpoint } from '@zenystx/helios-core/persistence/impl/Checkpoint';

let tmpDir: string;
let checkpointDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-checkpoint-test-'));
    checkpointDir = path.join(tmpDir, 'checkpoints');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Checkpoint', () => {
    test('readLatest returns null when no checkpoint exists', async () => {
        const cp = new Checkpoint(checkpointDir);
        const result = await cp.readLatest();
        expect(result).toBeNull();
    });

    test('write and readLatest round-trip', async () => {
        const cp = new Checkpoint(checkpointDir);

        const entries = [
            { mapName: 'mapA', partitionId: 0, key: new Uint8Array([1, 2, 3]), value: new Uint8Array([4, 5, 6]) },
            { mapName: 'mapB', partitionId: 1, key: new Uint8Array([7, 8]), value: new Uint8Array([9, 10]) },
        ];

        const metadata = await cp.write(42n, entries);
        expect(metadata.walSequence).toBe(42n);
        expect(metadata.entryCount).toBe(2);
        expect(metadata.mapCount).toBe(2);

        const result = await cp.readLatest();
        expect(result).not.toBeNull();
        expect(result!.metadata.walSequence).toBe(42n);
        expect(result!.metadata.entryCount).toBe(2);
        expect(result!.entries.length).toBe(2);

        const entryA = result!.entries.find(e => e.mapName === 'mapA')!;
        expect(Array.from(entryA.key)).toEqual([1, 2, 3]);
        expect(Array.from(entryA.value)).toEqual([4, 5, 6]);
        expect(entryA.partitionId).toBe(0);

        const entryB = result!.entries.find(e => e.mapName === 'mapB')!;
        expect(Array.from(entryB.key)).toEqual([7, 8]);
        expect(Array.from(entryB.value)).toEqual([9, 10]);
        expect(entryB.partitionId).toBe(1);
    });

    test('readLatest returns the most recent checkpoint', async () => {
        const cp = new Checkpoint(checkpointDir);

        // Write first checkpoint
        await cp.write(10n, [
            { mapName: 'map1', partitionId: 0, key: new Uint8Array([1]), value: new Uint8Array([100]) },
        ]);

        // Small delay to ensure distinct timestamps
        await new Promise(r => setTimeout(r, 5));

        // Write second checkpoint
        await cp.write(20n, [
            { mapName: 'map1', partitionId: 0, key: new Uint8Array([2]), value: new Uint8Array([200]) },
        ]);

        const result = await cp.readLatest();
        expect(result).not.toBeNull();
        expect(result!.metadata.walSequence).toBe(20n);
        expect(Array.from(result!.entries[0].key)).toEqual([2]);
    });

    test('cleanup removes old checkpoints keeping N most recent', async () => {
        const cp = new Checkpoint(checkpointDir);

        for (let i = 0; i < 4; i++) {
            await cp.write(BigInt(i), [
                { mapName: 'map', partitionId: 0, key: new Uint8Array([i]), value: new Uint8Array([i * 10]) },
            ]);
            await new Promise(r => setTimeout(r, 5));
        }

        await cp.cleanup(2);

        const files = fs.readdirSync(checkpointDir);
        const metaFiles = files.filter(f => f.endsWith('.meta.json'));
        const dataFiles = files.filter(f => f.endsWith('.jsonl'));

        expect(metaFiles.length).toBe(2);
        expect(dataFiles.length).toBe(2);
    });

    test('write with empty entries produces valid checkpoint', async () => {
        const cp = new Checkpoint(checkpointDir);
        const metadata = await cp.write(0n, []);

        expect(metadata.entryCount).toBe(0);
        expect(metadata.mapCount).toBe(0);

        const result = await cp.readLatest();
        expect(result).not.toBeNull();
        expect(result!.entries.length).toBe(0);
    });

    test('cleanup is a no-op when no checkpoints exist', async () => {
        const cp = new Checkpoint(checkpointDir);
        await expect(cp.cleanup(2)).resolves.toBeUndefined();
    });
});
