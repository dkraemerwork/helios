/**
 * Port of {@code com.hazelcast.persistence.PersistenceService}.
 * Manages the full persistence lifecycle: WAL, checkpoints, recovery, backup.
 *
 * Extended for WP13 with:
 *  - Multi-structure WAL support (MAP, QUEUE, CACHE, RINGBUFFER)
 *  - AES-256-GCM encryption at rest via EncryptedWAL
 *  - Coordinated cluster restart via ClusterRestartCoordinator
 *  - Hot backup via HotBackupService
 */
import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo';
import type { PersistenceConfig } from '@zenystx/helios-core/config/PersistenceConfig';
import * as path from 'path';
import { Checkpoint } from './impl/Checkpoint.js';
import {
    ClusterDataRecoveryPolicy,
    ClusterRestartCoordinator,
    type MemberRecoveryState,
    type RestartValidationResult,
} from './impl/ClusterRestartCoordinator.js';
import { EncryptedWAL } from './impl/EncryptedWAL.js';
import { HotBackupService } from './impl/HotBackupService.js';
import {
    CachePersistenceAdapter,
    MapPersistenceAdapter,
    QueuePersistenceAdapter,
    RingbufferPersistenceAdapter,
    decodeStructureKey
} from './impl/StructurePersistenceAdapter.js';
import { WALEntryType, WriteAheadLog } from './impl/WriteAheadLog.js';

export { ClusterDataRecoveryPolicy };
export type { MemberRecoveryState, RestartValidationResult };

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

/**
 * Resolve an AES-256 key from the config's key string.
 * Accepts:
 *  - "passphrase:<text>" — derive via PBKDF2
 *  - 64 hex chars        — decode as raw 32 bytes
 *  - other string        — treat as UTF-8 passphrase and derive
 */
function resolveEncryptionKey(keyString: string): Buffer {
    if (keyString.startsWith('passphrase:')) {
        return EncryptedWAL.deriveKey(keyString.slice('passphrase:'.length));
    }
    if (/^[0-9a-fA-F]{64}$/.test(keyString)) {
        return Buffer.from(keyString, 'hex');
    }
    // Treat as passphrase
    return EncryptedWAL.deriveKey(keyString);
}

export class PersistenceService {
    private readonly _config: PersistenceConfig;
    private _wal: WriteAheadLog | null = null;
    private _encryptedWal: EncryptedWAL | null = null;
    private _checkpoint: Checkpoint | null = null;
    private _running = false;
    private _forceStarting = false;
    private _checkpointTimer: ReturnType<typeof setInterval> | null = null;
    private _storeAdapter: MapStoreAdapter | null = null;
    private _hotBackupService: HotBackupService | null = null;
    private _clusterRestartCoordinator: ClusterRestartCoordinator | null = null;

    // Multi-structure adapters
    private _mapAdapter: MapPersistenceAdapter | null = null;
    private _queueAdapter: QueuePersistenceAdapter | null = null;
    private _cacheAdapter: CachePersistenceAdapter | null = null;
    private _ringbufferAdapter: RingbufferPersistenceAdapter | null = null;

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

        // Wire encryption if configured
        if (this._config.isEncryptionAtRestEnabled()) {
            const encConfig = this._config.getEncryptionAtRest();
            const key = resolveEncryptionKey(encConfig.key);
            this._encryptedWal = new EncryptedWAL(this._wal, key);
        }

        // Initialize multi-structure adapters (all share the same underlying WAL)
        this._mapAdapter = new MapPersistenceAdapter(this._wal);
        this._queueAdapter = new QueuePersistenceAdapter(this._wal);
        this._cacheAdapter = new CachePersistenceAdapter(this._wal);
        this._ringbufferAdapter = new RingbufferPersistenceAdapter(this._wal);

        // Initialize hot backup service
        this._hotBackupService = new HotBackupService(
            this._config.getBaseDir(),
            this._wal,
            this._checkpoint,
        );

        // Initialize cluster restart coordinator
        const policyStr = this._config.getClusterDataRecoveryPolicy();
        const policy = policyStr as ClusterDataRecoveryPolicy;
        this._clusterRestartCoordinator = new ClusterRestartCoordinator(policy);

        this._running = true;

        // Schedule periodic checkpoints (every 5 minutes)
        this._checkpointTimer = setInterval(() => {
            if (this._storeAdapter !== null) {
                void this.createCheckpoint(this._storeAdapter);
            }
        }, 300_000);
    }

    // ── Map operations ────────────────────────────────────────────────

    /** Record a PUT mutation in the WAL. */
    recordPut(mapName: string, partitionId: number, key: Uint8Array, value: Uint8Array): bigint | null {
        if (!this._wal || !this._running) return null;

        if (this._encryptedWal !== null) {
            return this._encryptedWal.appendEncrypted({
                type: WALEntryType.PUT,
                mapName,
                partitionId,
                key,
                value,
            });
        }

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

        if (this._encryptedWal !== null) {
            return this._encryptedWal.appendEncrypted({
                type: WALEntryType.REMOVE,
                mapName,
                partitionId,
                key,
                value: null,
            });
        }

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

        if (this._encryptedWal !== null) {
            return this._encryptedWal.appendEncrypted({
                type: WALEntryType.CLEAR,
                mapName,
                partitionId,
                key: null,
                value: null,
            });
        }

        return this._wal.append({
            type: WALEntryType.CLEAR,
            mapName,
            partitionId,
            key: null,
            value: null,
        });
    }

    // ── Queue operations ──────────────────────────────────────────────

    /** Record a queue OFFER operation in the WAL. */
    recordQueueOffer(queueName: string, value: Buffer): bigint | null {
        if (!this._queueAdapter || !this._running) return null;
        this._queueAdapter.recordOffer(queueName, value);
        return this._wal?.getCurrentSequence() ?? null;
    }

    /** Record a queue POLL operation in the WAL. */
    recordQueuePoll(queueName: string): bigint | null {
        if (!this._queueAdapter || !this._running) return null;
        this._queueAdapter.recordPoll(queueName);
        return this._wal?.getCurrentSequence() ?? null;
    }

    /** Record a queue CLEAR operation in the WAL. */
    recordQueueClear(queueName: string): bigint | null {
        if (!this._queueAdapter || !this._running) return null;
        this._queueAdapter.recordClear(queueName);
        return this._wal?.getCurrentSequence() ?? null;
    }

    // ── Cache operations ──────────────────────────────────────────────

    /** Record a cache PUT operation in the WAL. */
    recordCachePut(cacheName: string, key: Buffer, value: Buffer): bigint | null {
        if (!this._cacheAdapter || !this._running) return null;
        this._cacheAdapter.recordPut(cacheName, key, value);
        return this._wal?.getCurrentSequence() ?? null;
    }

    /** Record a cache REMOVE operation in the WAL. */
    recordCacheRemove(cacheName: string, key: Buffer): bigint | null {
        if (!this._cacheAdapter || !this._running) return null;
        this._cacheAdapter.recordRemove(cacheName, key);
        return this._wal?.getCurrentSequence() ?? null;
    }

    /** Record a cache CLEAR operation in the WAL. */
    recordCacheClear(cacheName: string): bigint | null {
        if (!this._cacheAdapter || !this._running) return null;
        this._cacheAdapter.recordClear(cacheName);
        return this._wal?.getCurrentSequence() ?? null;
    }

    // ── Ringbuffer operations ─────────────────────────────────────────

    /** Record a ringbuffer ADD operation in the WAL. */
    recordRingbufferAdd(ringbufferName: string, sequence: number, value: Buffer): bigint | null {
        if (!this._ringbufferAdapter || !this._running) return null;
        this._ringbufferAdapter.recordRingbufferAdd(ringbufferName, sequence, value);
        return this._wal?.getCurrentSequence() ?? null;
    }

    /** Record a ringbuffer CLEAR operation in the WAL. */
    recordRingbufferClear(ringbufferName: string): bigint | null {
        if (!this._ringbufferAdapter || !this._running) return null;
        this._ringbufferAdapter.recordClear(ringbufferName);
        return this._wal?.getCurrentSequence() ?? null;
    }

    // ── Adapter accessors ─────────────────────────────────────────────

    getMapAdapter(): MapPersistenceAdapter | null { return this._mapAdapter; }
    getQueueAdapter(): QueuePersistenceAdapter | null { return this._queueAdapter; }
    getCacheAdapter(): CachePersistenceAdapter | null { return this._cacheAdapter; }
    getRingbufferAdapter(): RingbufferPersistenceAdapter | null { return this._ringbufferAdapter; }

    // ── Checkpoint ────────────────────────────────────────────────────

    /** Create a checkpoint of current state. */
    async createCheckpoint(storeAdapter: MapStoreAdapter): Promise<void> {
        if (!this._wal || !this._checkpoint || !this._running) return;

        const walSeq = this._wal.getCurrentSequence();
        await this._checkpoint.write(walSeq, storeAdapter.getAllEntriesForPersistence());
        await this._checkpoint.cleanup(2);
        await this._wal.truncateBefore(walSeq);
    }

    // ── Recovery ──────────────────────────────────────────────────────

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
        // If encryption is enabled, use the decrypting reader
        const walEntries = this._encryptedWal !== null
            ? await this._encryptedWal.readAllDecrypted()
            : await this._wal.readAll();

        const relevantEntries = walEntries.filter(e => e.sequence > walSequence);

        for (const entry of relevantEntries) {
            try {
                // Detect multi-structure entries by trying to decode the structure prefix
                const structureInfo = decodeStructureKey(entry.mapName);
                const effectiveMapName = structureInfo !== null ? structureInfo.structureName : entry.mapName;

                if (entry.type === WALEntryType.PUT) {
                    if (entry.key && entry.value) {
                        storeAdapter.restoreEntry(effectiveMapName, entry.partitionId, entry.key, entry.value);
                        entriesRecovered++;
                    }
                } else if (entry.type === WALEntryType.REMOVE) {
                    if (entry.key) {
                        storeAdapter.removeEntry(effectiveMapName, entry.partitionId, entry.key);
                    }
                } else if (entry.type === WALEntryType.CLEAR) {
                    storeAdapter.clearMap(effectiveMapName);
                }
                // OFFER, POLL, ADD are structure-specific; higher-level services replay these
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

    // ── Cluster restart coordination ──────────────────────────────────

    /**
     * Coordinate a cluster restart using the configured recovery policy.
     * Exchange recovery state with other members and validate partition coverage.
     */
    async coordinateClusterRestart(
        members: MemberInfo[],
        localRecoveryState: MemberRecoveryState,
        remoteRecoveryStates: MemberRecoveryState[] = [],
    ): Promise<RestartValidationResult> {
        if (!this._clusterRestartCoordinator) {
            return {
                accepted: true,
                reason: 'Persistence not enabled — no restart coordination required.',
                recoveredPartitions: new Set(),
                missingPartitions: new Set(),
            };
        }
        return this._clusterRestartCoordinator.coordinateRestart(
            members,
            localRecoveryState,
            remoteRecoveryStates,
        );
    }

    // ── Hot backup ────────────────────────────────────────────────────

    /** Perform a hot backup to the specified directory. */
    async hotBackup(backupDir: string, memberList: string[] = []): Promise<import('./impl/HotBackupService.js').BackupResult> {
        if (!this._hotBackupService) {
            return {
                success: false,
                backupDir,
                fileCount: 0,
                totalBytes: 0,
                timestamp: Date.now(),
                error: 'Persistence service not started',
            };
        }
        return this._hotBackupService.backup(backupDir, memberList);
    }

    /** Restore from a backup directory. */
    async restoreFromBackup(backupDir: string): Promise<void> {
        if (!this._hotBackupService) {
            throw new Error('Persistence service not started');
        }
        return this._hotBackupService.restore(backupDir);
    }

    // ── Force start ───────────────────────────────────────────────────

    /** Force start — start the cluster even without full quorum for persistence recovery. */
    forceStart(): boolean {
        if (!this._config.isEnabled()) return false;
        this._forceStarting = true;
        return true;
    }

    isForceStarting(): boolean { return this._forceStarting; }

    // ── Legacy backup ─────────────────────────────────────────────────

    /** Create a backup of all persistent data (legacy checkpoint-based backup). */
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

    // ── Validation ────────────────────────────────────────────────────

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

    // ── Lifecycle ─────────────────────────────────────────────────────

    async shutdown(): Promise<void> {
        if (this._checkpointTimer !== null) {
            clearInterval(this._checkpointTimer);
            this._checkpointTimer = null;
        }
        this._wal?.close();
        this._running = false;
    }

    getWAL(): WriteAheadLog | null { return this._wal; }
    getEncryptedWAL(): EncryptedWAL | null { return this._encryptedWal; }
    getClusterRestartCoordinator(): ClusterRestartCoordinator | null { return this._clusterRestartCoordinator; }
    getHotBackupService(): HotBackupService | null { return this._hotBackupService; }
}
