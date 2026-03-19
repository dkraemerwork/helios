/**
 * Hot Backup Service — copies WAL segments and checkpoint files to a backup directory
 * without shutting down the node. On restore, files are copied back and recovery
 * is triggered on next startup.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WriteAheadLog } from './WriteAheadLog.js';
import type { Checkpoint } from './Checkpoint.js';

export interface BackupResult {
    readonly success: boolean;
    readonly backupDir: string;
    readonly fileCount: number;
    readonly totalBytes: number;
    readonly timestamp: number;
    readonly error?: string;
}

export interface BackupMetadata {
    readonly timestamp: number;
    readonly partitionCount: number;
    readonly memberList: string[];
    readonly walSequence: string;
    readonly checkpointTimestamp: number | null;
    readonly fileCount: number;
    readonly totalBytes: number;
    readonly heliosVersion: string;
}

export class HotBackupService {
    private readonly _persistenceBaseDir: string;
    private readonly _wal: WriteAheadLog | null;
    private readonly _checkpoint: Checkpoint | null;

    constructor(
        persistenceBaseDir: string,
        wal: WriteAheadLog | null = null,
        checkpoint: Checkpoint | null = null,
    ) {
        this._persistenceBaseDir = persistenceBaseDir;
        this._wal = wal;
        this._checkpoint = checkpoint;
    }

    /**
     * Perform a hot backup to the given directory.
     *
     * Steps:
     * 1. Fsync the WAL to ensure all pending writes are durable.
     * 2. Copy WAL segment files to the backup directory.
     * 3. Copy the latest checkpoint files to the backup directory.
     * 4. Write backup metadata (timestamp, partition count, member list).
     */
    async backup(backupDir: string, memberList: string[] = [], partitionCount = 271): Promise<BackupResult> {
        const timestamp = Date.now();
        const targetDir = path.join(backupDir, `backup-${timestamp}`);

        try {
            await fs.promises.mkdir(targetDir, { recursive: true });

            let fileCount = 0;
            let totalBytes = 0;

            // Step 1: Flush WAL (close + reopen would be disruptive; we sync the fd via the WAL's close/open).
            // In a hot backup scenario we copy files that are being appended to.
            // The WAL file descriptor is synced before we start copying.
            if (this._wal !== null) {
                this._wal.close();
                await this._wal.open();
            }

            // Step 2: Copy WAL segment files
            const walSourceDir = path.join(this._persistenceBaseDir, 'wal');
            if (fs.existsSync(walSourceDir)) {
                const walTargetDir = path.join(targetDir, 'wal');
                await fs.promises.mkdir(walTargetDir, { recursive: true });

                const walFiles = (await fs.promises.readdir(walSourceDir))
                    .filter(f => f.startsWith('wal-') && f.endsWith('.log'));

                for (const file of walFiles) {
                    const src = path.join(walSourceDir, file);
                    const dst = path.join(walTargetDir, file);
                    const stat = await fs.promises.stat(src);
                    await fs.promises.copyFile(src, dst);
                    fileCount++;
                    totalBytes += stat.size;
                }
            }

            // Step 3: Copy checkpoint files
            const checkpointSourceDir = path.join(this._persistenceBaseDir, 'checkpoints');
            let checkpointTimestamp: number | null = null;

            if (fs.existsSync(checkpointSourceDir)) {
                const cpTargetDir = path.join(targetDir, 'checkpoints');
                await fs.promises.mkdir(cpTargetDir, { recursive: true });

                const cpFiles = await fs.promises.readdir(checkpointSourceDir);

                // Find the latest checkpoint timestamp
                const metaFiles = cpFiles.filter(f => f.endsWith('.meta.json')).sort();
                if (metaFiles.length > 0) {
                    const latestMeta = metaFiles[metaFiles.length - 1];
                    const metaContent = JSON.parse(
                        await fs.promises.readFile(path.join(checkpointSourceDir, latestMeta), 'utf-8'),
                    );
                    checkpointTimestamp = metaContent.timestamp ?? null;

                    // Only copy the most recent checkpoint pair to minimize backup size
                    const dataFile = latestMeta.replace('.meta.json', '.jsonl');
                    for (const file of [latestMeta, dataFile]) {
                        const src = path.join(checkpointSourceDir, file);
                        if (fs.existsSync(src)) {
                            const stat = await fs.promises.stat(src);
                            await fs.promises.copyFile(src, path.join(cpTargetDir, file));
                            fileCount++;
                            totalBytes += stat.size;
                        }
                    }
                }
            }

            // Step 4: Write backup metadata
            const metadata: BackupMetadata = {
                timestamp,
                partitionCount,
                memberList,
                walSequence: (this._wal?.getCurrentSequence() ?? 0n).toString(),
                checkpointTimestamp,
                fileCount,
                totalBytes,
                heliosVersion: '1.0.0',
            };

            const metadataPath = path.join(targetDir, 'backup.meta.json');
            await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
            fileCount++;

            return { success: true, backupDir: targetDir, fileCount, totalBytes, timestamp };
        } catch (error) {
            return {
                success: false,
                backupDir: targetDir,
                fileCount: 0,
                totalBytes: 0,
                timestamp,
                error: String(error),
            };
        }
    }

    /**
     * Restore from a backup directory.
     *
     * Steps:
     * 1. Validate backup metadata.
     * 2. Stop the current WAL if running.
     * 3. Copy WAL and checkpoint files back to the persistence directory.
     * 4. Write a restore-trigger marker file so the next startup triggers recovery.
     */
    async restore(backupDir: string): Promise<void> {
        const metadataPath = path.join(backupDir, 'backup.meta.json');
        if (!fs.existsSync(metadataPath)) {
            throw new Error(`HotBackupService: backup metadata not found at ${metadataPath}`);
        }

        const metadata: BackupMetadata = JSON.parse(
            await fs.promises.readFile(metadataPath, 'utf-8'),
        );

        if (!metadata.timestamp || !metadata.walSequence) {
            throw new Error('HotBackupService: backup metadata is invalid or corrupt');
        }

        // Stop WAL to prevent further writes during restore
        if (this._wal !== null) {
            this._wal.close();
        }

        // Restore WAL segments
        const walBackupDir = path.join(backupDir, 'wal');
        if (fs.existsSync(walBackupDir)) {
            const walTargetDir = path.join(this._persistenceBaseDir, 'wal');
            await fs.promises.mkdir(walTargetDir, { recursive: true });

            const walFiles = (await fs.promises.readdir(walBackupDir))
                .filter(f => f.startsWith('wal-') && f.endsWith('.log'));

            for (const file of walFiles) {
                await fs.promises.copyFile(
                    path.join(walBackupDir, file),
                    path.join(walTargetDir, file),
                );
            }
        }

        // Restore checkpoint files
        const cpBackupDir = path.join(backupDir, 'checkpoints');
        if (fs.existsSync(cpBackupDir)) {
            const cpTargetDir = path.join(this._persistenceBaseDir, 'checkpoints');
            await fs.promises.mkdir(cpTargetDir, { recursive: true });

            const cpFiles = await fs.promises.readdir(cpBackupDir);
            for (const file of cpFiles) {
                await fs.promises.copyFile(
                    path.join(cpBackupDir, file),
                    path.join(cpTargetDir, file),
                );
            }
        }

        // Write restore marker so next startup knows to trigger full recovery
        const restoreMarkerPath = path.join(this._persistenceBaseDir, '.restore-pending');
        await fs.promises.writeFile(restoreMarkerPath, JSON.stringify({
            restoredFrom: backupDir,
            restoredAt: Date.now(),
            backupTimestamp: metadata.timestamp,
            walSequence: metadata.walSequence,
        }, null, 2));
    }

    /**
     * List all available backups in a backup root directory.
     */
    async listBackups(backupRootDir: string): Promise<BackupMetadata[]> {
        if (!fs.existsSync(backupRootDir)) return [];

        const entries = await fs.promises.readdir(backupRootDir);
        const metadataList: BackupMetadata[] = [];

        for (const entry of entries) {
            const metaPath = path.join(backupRootDir, entry, 'backup.meta.json');
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
                    metadataList.push(meta);
                } catch {
                    // Skip malformed backup entries
                }
            }
        }

        return metadataList.sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Check if a restore is pending (marker file exists from a previous restore()).
     */
    isRestorePending(): boolean {
        return fs.existsSync(path.join(this._persistenceBaseDir, '.restore-pending'));
    }

    /**
     * Clear the restore-pending marker after successful recovery.
     */
    async clearRestoreMarker(): Promise<void> {
        const markerPath = path.join(this._persistenceBaseDir, '.restore-pending');
        if (fs.existsSync(markerPath)) {
            await fs.promises.unlink(markerPath);
        }
    }
}
