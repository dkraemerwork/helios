/**
 * Tests for PersistenceService lifecycle, WAL recording, checkpoint, and recovery.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PersistenceConfig } from '@zenystx/helios-core/config/PersistenceConfig';
import type { MapStoreAdapter } from '@zenystx/helios-core/persistence/PersistenceService';
import { PersistenceService } from '@zenystx/helios-core/persistence/PersistenceService';

let tmpDir: string;

function makeAdapter(store: Map<string, Uint8Array> = new Map()): MapStoreAdapter {
    const data = store;
    return {
        getAllEntriesForPersistence() {
            const result: Array<{ mapName: string; partitionId: number; key: Uint8Array; value: Uint8Array }> = [];
            for (const [key, value] of data.entries()) {
                const [mapName, partitionStr, keyB64] = key.split('::');
                result.push({
                    mapName,
                    partitionId: parseInt(partitionStr, 10),
                    key: Buffer.from(keyB64, 'base64'),
                    value,
                });
            }
            return result;
        },
        restoreEntry(mapName: string, partitionId: number, key: Uint8Array, value: Uint8Array) {
            const storeKey = `${mapName}::${partitionId}::${Buffer.from(key).toString('base64')}`;
            data.set(storeKey, value);
        },
        removeEntry(mapName: string, partitionId: number, key: Uint8Array) {
            const storeKey = `${mapName}::${partitionId}::${Buffer.from(key).toString('base64')}`;
            data.delete(storeKey);
        },
        clearMap(mapName: string) {
            for (const key of [...data.keys()]) {
                if (key.startsWith(`${mapName}::`)) {
                    data.delete(key);
                }
            }
        },
        clearAll() {
            data.clear();
        },
    };
}

function makeConfig(baseDir: string): PersistenceConfig {
    return new PersistenceConfig()
        .setEnabled(true)
        .setBaseDir(baseDir);
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-persistence-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('PersistenceService', () => {
    test('isEnabled reflects config', () => {
        const disabled = new PersistenceService(new PersistenceConfig());
        expect(disabled.isEnabled()).toBe(false);

        const enabled = new PersistenceService(makeConfig(tmpDir));
        expect(enabled.isEnabled()).toBe(true);
    });

    test('start creates WAL directory', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();
        expect(fs.existsSync(path.join(tmpDir, 'wal'))).toBe(true);
        await svc.shutdown();
    });

    test('isRunning reflects lifecycle', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        expect(svc.isRunning()).toBe(false);

        await svc.start();
        expect(svc.isRunning()).toBe(true);

        await svc.shutdown();
        expect(svc.isRunning()).toBe(false);
    });

    test('recordPut returns sequence', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();

        const seq = svc.recordPut('map1', 0, new Uint8Array([1]), new Uint8Array([2]));
        expect(seq).toBe(1n);

        await svc.shutdown();
    });

    test('recordRemove returns sequence after PUT', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();

        svc.recordPut('map1', 0, new Uint8Array([1]), new Uint8Array([2]));
        const seq = svc.recordRemove('map1', 0, new Uint8Array([1]));
        expect(seq).toBe(2n);

        await svc.shutdown();
    });

    test('recordClear returns sequence', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();

        const seq = svc.recordClear('map1', 0);
        expect(seq).toBe(1n);

        await svc.shutdown();
    });

    test('recordPut returns null when not running', () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        // Not started
        const seq = svc.recordPut('map1', 0, new Uint8Array([1]), new Uint8Array([2]));
        expect(seq).toBeNull();
    });

    test('createCheckpoint and recover round-trip via checkpoint', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();

        // Record some mutations
        svc.recordPut('users', 0, new Uint8Array([1]), new Uint8Array([100]));
        svc.recordPut('users', 1, new Uint8Array([2]), new Uint8Array([200]));

        // Build adapter with current state
        const store = new Map<string, Uint8Array>();
        store.set('users::0::AQ==', new Uint8Array([100]));
        store.set('users::1::Ag==', new Uint8Array([200]));
        const adapter = makeAdapter(store);

        await svc.createCheckpoint(adapter);
        await svc.shutdown();

        // Recover on a fresh service instance
        const svc2 = new PersistenceService(makeConfig(tmpDir));
        await svc2.start();

        const recoveredStore = new Map<string, Uint8Array>();
        const recoveredAdapter = makeAdapter(recoveredStore);

        const result = await svc2.recover(recoveredAdapter);
        expect(result.success).toBe(true);
        expect(result.fromCheckpoint).toBe(true);
        expect(result.entriesRecovered).toBe(2);
        expect(result.mapsRecovered).toBe(1);

        await svc2.shutdown();
    });

    test('recover from WAL only (no checkpoint)', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();

        svc.recordPut('orders', 0, new Uint8Array([10]), new Uint8Array([20]));
        await svc.shutdown();

        // Recover
        const svc2 = new PersistenceService(makeConfig(tmpDir));
        await svc2.start();

        const recoveredStore = new Map<string, Uint8Array>();
        const result = await svc2.recover(makeAdapter(recoveredStore));

        expect(result.success).toBe(true);
        expect(result.fromCheckpoint).toBe(false);
        expect(result.walEntriesReplayed).toBe(1);
        expect(result.entriesRecovered).toBe(1);

        await svc2.shutdown();
    });

    test('validate returns valid on fresh start (no checkpoint)', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();

        const result = await svc.validate();
        expect(result.valid).toBe(true);
        expect(result.issues.length).toBe(0);

        await svc.shutdown();
    });

    test('validate returns valid after checkpoint write', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();

        const adapter = makeAdapter(new Map());
        await svc.createCheckpoint(adapter);

        const result = await svc.validate();
        expect(result.valid).toBe(true);

        await svc.shutdown();
    });

    test('forceStart sets forceStarting flag', () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        expect(svc.isForceStarting()).toBe(false);

        const result = svc.forceStart();
        expect(result).toBe(true);
        expect(svc.isForceStarting()).toBe(true);
    });

    test('forceStart returns false when persistence disabled', () => {
        const svc = new PersistenceService(new PersistenceConfig());
        const result = svc.forceStart();
        expect(result).toBe(false);
    });

    test('backup creates checkpoint in backup dir', async () => {
        const backupDir = path.join(tmpDir, 'backups');
        const config = makeConfig(tmpDir).setBackupDir(backupDir);
        const svc = new PersistenceService(config);
        await svc.start();

        const store = new Map<string, Uint8Array>();
        store.set('products::0::AQ==', new Uint8Array([99]));
        const adapter = makeAdapter(store);

        const result = await svc.backup(adapter);
        expect(result.success).toBe(true);
        expect(result.entriesBackedUp).toBe(1);
        expect(fs.existsSync(result.backupDir)).toBe(true);

        await svc.shutdown();
    });

    test('backup returns failure when no backupDir configured', async () => {
        const svc = new PersistenceService(makeConfig(tmpDir));
        await svc.start();

        const result = await svc.backup(makeAdapter());
        expect(result.success).toBe(false);

        await svc.shutdown();
    });

    test('disabled service: recordPut/Remove/Clear all return null', async () => {
        const svc = new PersistenceService(new PersistenceConfig());
        await svc.start(); // no-op when disabled

        expect(svc.recordPut('m', 0, new Uint8Array([1]), new Uint8Array([2]))).toBeNull();
        expect(svc.recordRemove('m', 0, new Uint8Array([1]))).toBeNull();
        expect(svc.recordClear('m', 0)).toBeNull();

        await svc.shutdown();
    });
});
