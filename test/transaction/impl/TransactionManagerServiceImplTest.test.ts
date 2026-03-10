/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionManagerServiceImplTest}.
 *
 * Tests backup log management operations on TransactionManagerServiceImpl.
 */
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction';
import { TransactionManagerServiceImpl } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl';
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException';
import { beforeEach, describe, expect, it } from 'bun:test';

const TXN = crypto.randomUUID();

describe('TransactionManagerServiceImplTest', () => {
    let txService: TransactionManagerServiceImpl;

    beforeEach(() => {
        const nodeEngine = new TestNodeEngine();
        txService = new TransactionManagerServiceImpl(nodeEngine);
    });

    // ── createBackupLog ─────────────────────────────────────────────────

    it('createBackupLog_whenNotCreated', () => {
        const callerUuid = crypto.randomUUID();
        void txService.createBackupLog(callerUuid, TXN);
        assertTxLogState(TXN, State.ACTIVE);
    });

    it('createBackupLog_whenAlreadyExist', () => {
        const callerUuid = crypto.randomUUID();
        void txService.createBackupLog(callerUuid, TXN);
        expect(() => txService.createBackupLog(callerUuid, TXN)).toThrow(TransactionException);
    });

    // ── replicaBackupLog ────────────────────────────────────────────────

    it('replicaBackupLog_whenNotExist_thenTransactionException', () => {
        const callerUuid = crypto.randomUUID();
        expect(() => txService.replicaBackupLog([], callerUuid, TXN, 1, 1)).toThrow(TransactionException);
    });

    it('replicaBackupLog_whenExist', async () => {
        const callerUuid = crypto.randomUUID();
        await txService.createBackupLog(callerUuid, TXN);
        await txService.replicaBackupLog([], callerUuid, TXN, 1, 1);
        assertTxLogState(TXN, State.PREPARED);
    });

    it('replicaBackupLog_whenNotActive', () => {
        const callerUuid = crypto.randomUUID();
        void txService.createBackupLog(callerUuid, TXN);
        txService.txBackupLogs.get(TXN)!.state = State.ROLLED_BACK;
        expect(() => txService.replicaBackupLog([], callerUuid, TXN, 1, 1)).toThrow(TransactionException);
    });

    // ── rollbackBackupLog ───────────────────────────────────────────────

    it('rollbackBackupLog_whenExist', async () => {
        const callerUuid = crypto.randomUUID();
        await txService.createBackupLog(callerUuid, TXN);
        await txService.rollbackBackupLog(TXN);
        assertTxLogState(TXN, State.ROLLING_BACK);
    });

    it('rollbackBackupLog_whenNotExist_thenIgnored', () => {
        // should not throw
        txService.rollbackBackupLog(TXN);
    });

    // ── purgeBackupLog ──────────────────────────────────────────────────

    it('purgeBackupLog_whenExist_thenRemoved', () => {
        const callerUuid = crypto.randomUUID();
        void txService.createBackupLog(callerUuid, TXN);
        void txService.purgeBackupLog(TXN);
        expect(txService.txBackupLogs.has(TXN)).toBe(false);
    });

    it('purgeBackupLog_whenNotExist_thenIgnored', () => {
        // should not throw
        txService.purgeBackupLog(TXN);
    });

    // ── helper ──────────────────────────────────────────────────────────

    function assertTxLogState(txId: string, state: State): void {
        const backupLog = txService.txBackupLogs.get(txId);
        expect(backupLog).not.toBeNull();
        expect(backupLog).not.toBeUndefined();
        expect(backupLog!.state).toBe(state);
    }
});
