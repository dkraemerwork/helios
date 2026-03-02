/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionImpl_OnePhaseTest}.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { TransactionImpl } from '@helios/transaction/impl/TransactionImpl';
import type { TransactionManagerServiceLike } from '@helios/transaction/impl/TransactionImpl';
import { State } from '@helios/transaction/impl/Transaction';
import { TransactionOptions, TransactionType } from '@helios/transaction/TransactionOptions';
import { TransactionException } from '@helios/transaction/TransactionException';
import { TransactionNotActiveException } from '@helios/transaction/TransactionNotActiveException';
import { MwCounter } from '@helios/internal/util/counters/MwCounter';
import { TestNodeEngine } from '@helios/test-support/TestNodeEngine';
import { MockTransactionLogRecord } from './MockTransactionLogRecord';

function makeMockManager(): TransactionManagerServiceLike {
    return {
        startCount:    MwCounter.newMwCounter(),
        commitCount:   MwCounter.newMwCounter(),
        rollbackCount: MwCounter.newMwCounter(),
        pickBackupLogAddresses: (_d: number) => [],
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
