/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.BackupAwareOperation}.
 *
 * An Operation that supports backup replication. After the primary executes,
 * the OperationBackupHandler checks shouldBackup() and sends backup copies
 * to replica nodes.
 *
 * Total sync + async backup count must not exceed MAX_BACKUP_COUNT (6).
 */
import type { Operation } from '@zenystx/core/spi/impl/operationservice/Operation';

export interface BackupAwareOperation {
    /** Whether a backup should be sent after this operation executes. */
    shouldBackup(): boolean;

    /** Number of synchronous backups (0–6). Caller waits for ack. */
    getSyncBackupCount(): number;

    /** Number of asynchronous backups (0–6). Fire-and-forget. */
    getAsyncBackupCount(): number;

    /** Create the backup operation to execute on replica nodes. */
    getBackupOperation(): Operation;
}

/**
 * Runtime type guard for BackupAwareOperation.
 * Use this instead of instanceof since BackupAwareOperation is an interface.
 */
export function isBackupAwareOperation(op: unknown): op is BackupAwareOperation {
    return (
        op !== null &&
        typeof op === 'object' &&
        typeof (op as BackupAwareOperation).shouldBackup === 'function' &&
        typeof (op as BackupAwareOperation).getSyncBackupCount === 'function' &&
        typeof (op as BackupAwareOperation).getAsyncBackupCount === 'function' &&
        typeof (op as BackupAwareOperation).getBackupOperation === 'function'
    );
}
