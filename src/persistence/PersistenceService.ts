/**
 * Port of {@code com.hazelcast.persistence.PersistenceService}.
 * Manages the full persistence lifecycle: WAL, checkpoints, recovery, backup.
 */
import * as path from 'path';
import type { PersistenceConfig } from '@zenystx/helios-core/config/PersistenceConfig';
import { Checkpoint } from './impl/Checkpoint';
import { WALEntryType, WriteAheadLog } from './impl/WriteAheadLog';

export interface PersistenceRecoveryResult {
    readonly success: boolean;
    readonly entriesRecovered: number;
    readonly mapsRecovered: number;
    readonly walSequence: bigint;
    readonly fromCheckpoint: boolean;
    readonly walEntriesReplayed: number;
    readonly errors: string[];
}

export interface PersistenceBackupResult {
    readonly success: boolean;
    readonly backupDir: string;
    readonly entriesBackedUp: number;
    readonly timestamp: number;
}

export interface MapStoreAdapter {
    getAllEntriesForPersistence(): Iterable<{
        mapName: string;
        partitionId: number;
        key: Uint8Array;
        value: Uint8Array;
    }>;
    restoreEntry(mapName: string, partitionId: number, key: Uint8Array, value: Uint8Array): void;
    removeEntry(mapName: string, partitionId: number, key: Uint8Array): void;
    clearMap(mapName: string): void;
    clearAll(): void;
}

export class PersistenceService {
    private readonly _config: PersistenceConfig;
    private _wal: WriteAheadLog | null = null;
    private _checkpoint: Checkpoint | null = null;
    private _running = false;
    private _forceStarting = false;
    private _checkpointTimer: ReturnType<typeof setInterval> | null = null;
    private _storeAdapter: MapStoreAdapter | null = null;

    constructor(config: PersistenceConfig) {
        this._config = config;
    }

    isRunning(): boolean { return this._running; }
    isEnabled(): boolean { return this._config.isEnabled(); }

    async start(): Promise<void> {
        if (!this._config.isEnabled() || this._running) return;

        const walDir = path.join(this._config.getBaseDir(), 'wal');
        const checkpointDir = path.join(this._config.getBaseDir(), 'checkpoints');

        this._wal = new WriteAheadLog(walDir);
        this._checkpoint = new Checkpoint(checkpointDir);
        await this._wal.open();
        this._running = true;

        // Schedule periodic checkpoints (every 5 minutes)
        this._checkpointTimer = setInterval(() => {
            if (this._storeAdapter !== null) {
                void this.createCheckpoint(this._storeAdapter);
            }
        }, 300_000);
    }

    /** Record a PUT mutation in the WAL. */
    recordPut(mapName: string, partitionId: number, key: Uint8Array, value: Uint8Array): bigint | null {
        if (!this._wal || !this._running) return null;
        return this._wal.append({
            type: WALEntryType.PUT,
            mapName,
            partitionId,
            key,
            value,
        });
    }

    /** Record a REMOVE mutation in the WAL. */
    recordRemove(mapName: string, partitionId: number, key: Uint8Array): bigint | null {
        if (!this._wal || !this._running) return null;
        return this._wal.append({
            type: WALEntryType.REMOVE,
            mapName,
            partitionId,
            key,
            value: null,
        });
    }

    /** Record a CLEAR mutation in the WAL. */
    recordClear(mapName: string, partitionId: number): bigint | null {
        if (!this._wal || !this._running) return null;
        return this._wal.append({
            type: WALEntryType.CLEAR,
            mapName,
            partitionId,
            key: null,
            value: null,
        });
    }

    /** Create a checkpoint of current state. */
    async createCheckpoint(storeAdapter: MapStoreAdapter): Promise<void> {
        if (!this._wal || !this._checkpoint || !this._running) return;

        const walSeq = this._wal.getCurrentSequence();
        await this._checkpoint.write(walSeq, storeAdapter.getAllEntriesForPersistence());
        await this._checkpoint.cleanup(2);
        await this._wal.truncateBefore(walSeq);
    }

    /** Recover state from checkpoint + WAL replay. */
    async recover(storeAdapter: MapStoreAdapter): Promise<PersistenceRecoveryResult> {
        // Store the adapter so the periodic checkpoint timer can use it.
        this._storeAdapter = storeAdapter;

        const errors: string[] = [];
        let entriesRecovered = 0;
        let mapsRecovered = 0;
        let walEntriesReplayed = 0;
        let fromCheckpoint = false;
        let walSequence = 0n;

        if (!this._checkpoint || !this._wal) {
            return {
                success: false,
                entriesRecovered,
                mapsRecovered,
                walSequence,
                fromCheckpoint,
                walEntriesReplayed,
                errors: ['Persistence not initialized'],
            };
        }

        // Step 1: Restore from latest checkpoint
        const checkpoint = await this._checkpoint.readLatest();
        if (checkpoint !== null) {
            fromCheckpoint = true;
            walSequence = checkpoint.metadata.walSequence;
            const mapNames = new Set<string>();

            for (const entry of checkpoint.entries) {
                try {
                    storeAdapter.restoreEntry(entry.mapName, entry.partitionId, entry.key, entry.value);
                    entriesRecovered++;
                    mapNames.add(entry.mapName);
                } catch (e) {
                    errors.push(`Checkpoint restore error: ${e}`);
                }
            }
            mapsRecovered = mapNames.size;
        }

        // Step 2: Replay WAL entries after checkpoint sequence
        const walEntries = await this._wal.readAll();
        const relevantEntries = walEntries.filter(e => e.sequence > walSequence);

        for (const entry of relevantEntries) {
            try {
                if (entry.type === WALEntryType.PUT) {
                    if (entry.key && entry.value) {
                        storeAdapter.restoreEntry(entry.mapName, entry.partitionId, entry.key, entry.value);
                        entriesRecovered++;
                    }
                } else if (entry.type === WALEntryType.REMOVE) {
                    if (entry.key) {
                        storeAdapter.removeEntry(entry.mapName, entry.partitionId, entry.key);
                    }
                } else if (entry.type === WALEntryType.CLEAR) {
                    storeAdapter.clearMap(entry.mapName);
                }
                walEntriesReplayed++;
            } catch (e) {
                errors.push(`WAL replay error at seq ${entry.sequence}: ${e}`);
            }
        }

        if (relevantEntries.length > 0) {
            walSequence = relevantEntries[relevantEntries.length - 1].sequence;
        }

        return {
            success: errors.length === 0,
            entriesRecovered,
            mapsRecovered,
            walSequence,
            fromCheckpoint,
            walEntriesReplayed,
            errors,
        };
    }

    /** Force start — start the cluster even without full quorum for persistence recovery. */
    forceStart(): boolean {
        if (!this._config.isEnabled()) return false;
        this._forceStarting = true;
        return true;
    }

    isForceStarting(): boolean { return this._forceStarting; }

    /** Create a backup of all persistent data. */
    async backup(storeAdapter: MapStoreAdapter): Promise<PersistenceBackupResult> {
        const backupDir = this._config.getBackupDir();
        if (!backupDir) {
            return { success: false, backupDir: '', entriesBackedUp: 0, timestamp: Date.now() };
        }

        const timestamp = Date.now();
        const targetDir = path.join(backupDir, `backup-${timestamp}`);
        const checkpoint = new Checkpoint(targetDir);

        const entries = [...storeAdapter.getAllEntriesForPersistence()];
        const entriesBackedUp = entries.length;
        await checkpoint.write(this._wal?.getCurrentSequence() ?? 0n, entries);

        return { success: true, backupDir: targetDir, entriesBackedUp, timestamp };
    }

    /** Validate persisted data integrity. */
    async validate(): Promise<{ valid: boolean; issues: string[] }> {
        const issues: string[] = [];

        if (!this._checkpoint) {
            return { valid: false, issues: ['Checkpoint not initialized'] };
        }

        const checkpoint = await this._checkpoint.readLatest();
        if (checkpoint === null) {
            // No checkpoint yet — valid (fresh start)
            return { valid: true, issues: [] };
        }

        // Validate checkpoint metadata
        if (checkpoint.metadata.entryCount !== checkpoint.entries.length) {
            issues.push(`Checkpoint entry count mismatch: expected ${checkpoint.metadata.entryCount}, got ${checkpoint.entries.length}`);
        }

        // Validate WAL readability
        if (this._wal) {
            try {
                await this._wal.readAll();
            } catch (e) {
                issues.push(`WAL read error: ${e}`);
            }
        }

        return { valid: issues.length === 0, issues };
    }

    async shutdown(): Promise<void> {
        if (this._checkpointTimer !== null) {
            clearInterval(this._checkpointTimer);
            this._checkpointTimer = null;
        }
        this._wal?.close();
        this._running = false;
    }
}
