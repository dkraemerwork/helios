import { describe, test, expect } from 'bun:test';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { MAX_BACKUP_COUNT } from '@zenystx/helios-core/internal/partition/IPartition';

/**
 * Tests for BackupAwareOperation interface (Block 16.D1).
 *
 * Validates that a concrete Operation implementing BackupAwareOperation
 * correctly exposes backup semantics and respects MAX_BACKUP_COUNT.
 */

class TestBackupOp extends Operation implements BackupAwareOperation {
    constructor(
        private readonly _shouldBackup: boolean,
        private readonly _syncCount: number,
        private readonly _asyncCount: number,
    ) {
        super();
    }

    async run(): Promise<void> {
        this.sendResponse('ok');
    }

    shouldBackup(): boolean {
        return this._shouldBackup;
    }

    getSyncBackupCount(): number {
        return this._syncCount;
    }

    getAsyncBackupCount(): number {
        return this._asyncCount;
    }

    getBackupOperation(): Operation {
        const op = new NoOpBackupOperation();
        op.partitionId = this.partitionId;
        return op;
    }
}

class NoOpBackupOperation extends Operation {
    async run(): Promise<void> {
        // backup apply — no-op for test
    }
}

function isBackupAwareOperation(op: unknown): op is BackupAwareOperation {
    return (
        op !== null &&
        typeof op === 'object' &&
        typeof (op as BackupAwareOperation).shouldBackup === 'function' &&
        typeof (op as BackupAwareOperation).getSyncBackupCount === 'function' &&
        typeof (op as BackupAwareOperation).getAsyncBackupCount === 'function' &&
        typeof (op as BackupAwareOperation).getBackupOperation === 'function'
    );
}

describe('BackupAwareOperation', () => {
    test('shouldBackup returns configured value', () => {
        const opTrue = new TestBackupOp(true, 1, 0);
        const opFalse = new TestBackupOp(false, 0, 0);

        expect(opTrue.shouldBackup()).toBe(true);
        expect(opFalse.shouldBackup()).toBe(false);
    });

    test('sync and async backup counts within MAX_BACKUP_COUNT', () => {
        const op = new TestBackupOp(true, 2, 3);

        expect(op.getSyncBackupCount()).toBe(2);
        expect(op.getAsyncBackupCount()).toBe(3);
        expect(op.getSyncBackupCount() + op.getAsyncBackupCount()).toBeLessThanOrEqual(MAX_BACKUP_COUNT);
    });

    test('getBackupOperation returns an Operation', () => {
        const op = new TestBackupOp(true, 1, 0);
        op.partitionId = 42;

        const backupOp = op.getBackupOperation();
        expect(backupOp).toBeInstanceOf(Operation);
        expect(backupOp.partitionId).toBe(42);
    });

    test('type guard detects BackupAwareOperation', () => {
        const backupOp = new TestBackupOp(true, 1, 0);
        const plainOp = new NoOpBackupOperation();

        expect(isBackupAwareOperation(backupOp)).toBe(true);
        expect(isBackupAwareOperation(plainOp)).toBe(false);
    });

    test('MAX_BACKUP_COUNT is 6', () => {
        expect(MAX_BACKUP_COUNT).toBe(6);
    });
});
