/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionImpl_OnePhaseTest}.
 */
import { MwCounter } from '@zenystx/helios-core/internal/util/counters/MwCounter';
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction';
import type { TransactionManagerServiceLike } from '@zenystx/helios-core/transaction/impl/TransactionImpl';
import { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl';
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException';
import { TransactionNotActiveException } from '@zenystx/helios-core/transaction/TransactionNotActiveException';
import { TransactionOptions, TransactionType } from '@zenystx/helios-core/transaction/TransactionOptions';
import { beforeEach, describe, expect, it } from 'bun:test';
import { MockTransactionLogRecord } from './MockTransactionLogRecord';

function makeMockManager(): TransactionManagerServiceLike {
    return {
        startCount:    MwCounter.newMwCounter(),
        commitCount:   MwCounter.newMwCounter(),
        rollbackCount: MwCounter.newMwCounter(),
        pickBackupLogAddresses: (_d: number) => [],
        rememberBackupTargets: () => {},
        createBackupLog: async () => {},
        createAllowedDuringPassiveStateBackupLog: async () => {},
        replicaBackupLog: async () => {},
        markCommitting: async () => {},
        markCommitted: async () => {},
        markCommitFailed: async () => {},
        rollbackBackupLog: async () => {},
        markRolledBack: async () => {},
        purgeBackupLog: async () => {},
    };
}

describe('TransactionImpl_OnePhaseTest', () => {
    let manager: TransactionManagerServiceLike;
    let nodeEngine: TestNodeEngine;
    let options: TransactionOptions;

    beforeEach(() => {
        manager = makeMockManager();
        nodeEngine = new TestNodeEngine();
        options = new TransactionOptions().setTransactionType(TransactionType.ONE_PHASE);
    });

    // ── requiresPrepare ───────────────────────────────────────────────────

    it('requiresPrepare', async () => {
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        expect(tx.requiresPrepare()).toBe(false);
    });

    // ── prepare ───────────────────────────────────────────────────────────

    it('prepare_whenNotActive', async () => {
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        await tx.rollback();
        await expect(tx.prepare()).rejects.toBeInstanceOf(TransactionNotActiveException);
    });

    // ── commit ────────────────────────────────────────────────────────────

    it('commit_whenNotActive', async () => {
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        await tx.rollback();
        await expect(tx.commit()).rejects.toThrow();
    });

    it('commit_ThrowsExceptionDuringCommit', async () => {
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        tx.add(new MockTransactionLogRecord().failCommit());
        await expect(tx.commit()).rejects.toBeInstanceOf(TransactionException);
    });

    // ── rollback ──────────────────────────────────────────────────────────

    it('rollback_whenEmpty', async () => {
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        await tx.rollback();
        expect(tx.getState()).toBe(State.ROLLED_BACK);
    });

    it('rollback_whenNotActive', async () => {
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        await tx.rollback();
        await expect(tx.rollback()).rejects.toThrow();
    });

    it('rollback_whenRollingBackCommitFailedTransaction', async () => {
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        tx.add(new MockTransactionLogRecord().failCommit());
        try {
            await tx.commit();
            throw new Error('Expected TransactionException to be thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(TransactionException);
        }
        await tx.rollback();
        expect(tx.getState()).toBe(State.ROLLED_BACK);
    });
});
