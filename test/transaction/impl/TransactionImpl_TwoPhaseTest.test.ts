/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionImpl_TwoPhaseTest}.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { TransactionImpl } from '@helios/transaction/impl/TransactionImpl';
import type { TransactionManagerServiceLike } from '@helios/transaction/impl/TransactionImpl';
import { State } from '@helios/transaction/impl/Transaction';
import { TransactionOptions, TransactionType } from '@helios/transaction/TransactionOptions';
import { TransactionException } from '@helios/transaction/TransactionException';
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

function twoPhaseDurability0(): TransactionOptions {
    return new TransactionOptions()
        .setTransactionType(TransactionType.TWO_PHASE)
        .setDurability(0);
}

describe('TransactionImpl_TwoPhaseTest', () => {
    let manager: TransactionManagerServiceLike;
    let nodeEngine: TestNodeEngine;

    beforeEach(() => {
        manager = makeMockManager();
        nodeEngine = new TestNodeEngine();
    });

    // ── begin ─────────────────────────────────────────────────────────────

    it('begin_whenBeginThrowsException', async () => {
        const expectedException = new Error('example exception');
        const throwingManager: TransactionManagerServiceLike = {
            startCount:    MwCounter.newMwCounter(),
            commitCount:   MwCounter.newMwCounter(),
            rollbackCount: MwCounter.newMwCounter(),
            pickBackupLogAddresses: (_d: number) => { throw expectedException; },
        };

        const options = twoPhaseDurability0();
        let tx = new TransactionImpl(throwingManager, nodeEngine, options, null);
        try {
            await tx.begin();
            throw new Error('Expected exception not thrown');
        } catch (e) {
            expect(e).toBe(expectedException);
        }

        // second independent transaction in same context should also fail
        tx = new TransactionImpl(throwingManager, nodeEngine, options, crypto.randomUUID());
        try {
            await tx.begin();
            throw new Error('Expected exception not thrown');
        } catch (e) {
            expect(e).toBe(expectedException);
        }
    });

    // ── requiresPrepare ───────────────────────────────────────────────────

    it('requiresPrepare_whenEmpty', async () => {
        await assertRequiresPrepare(0, false);
    });

    it('requiresPrepare_whenLogRecord', async () => {
        await assertRequiresPrepare(1, false);
    });

    it('requiresPrepare_whenMultipleLogRecords', async () => {
        await assertRequiresPrepare(2, true);
    });

    async function assertRequiresPrepare(recordCount: number, expected: boolean): Promise<void> {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        for (let k = 0; k < recordCount; k++) {
            tx.add(new MockTransactionLogRecord());
        }
        expect(tx.requiresPrepare()).toBe(expected);
    }

    // ── prepare ───────────────────────────────────────────────────────────

    it('prepare_whenThrowsExceptionDuringPrepare', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        tx.add(new MockTransactionLogRecord().failPrepare());
        await expect(tx.prepare()).rejects.toBeInstanceOf(TransactionException);
    });

    // ── commit ────────────────────────────────────────────────────────────

    it('commit_whenNotActive', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        await tx.rollback();
        await expect(tx.commit()).rejects.toThrow();
    });

    it('commit_whenNotPreparedAndMoreThanOneTransactionLogRecord', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        tx.add(new MockTransactionLogRecord());
        tx.add(new MockTransactionLogRecord());
        await expect(tx.commit()).rejects.toThrow();
    });

    it('commit_whenOneTransactionLogRecord_thenCommit', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        tx.add(new MockTransactionLogRecord());
        await tx.commit();
        expect(tx.getState()).toBe(State.COMMITTED);
    });

    it('commit_whenThrowsExceptionDuringCommit', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        tx.add(new MockTransactionLogRecord().failCommit());
        await tx.prepare();

        try {
            await tx.commit();
            throw new Error('Expected TransactionException');
        } catch (e) {
            expect(e).toBeInstanceOf(TransactionException);
        }

        expect(tx.getState()).toBe(State.COMMIT_FAILED);
    });

    // ── rollback ──────────────────────────────────────────────────────────

    it('rollback', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        await tx.rollback();
        expect(tx.getState()).toBe(State.ROLLED_BACK);
    });

    it('rollback_whenAlreadyRolledBack', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        await tx.rollback();
        await expect(tx.rollback()).rejects.toThrow();
    });

    it('rollback_whenFailureDuringRollback', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        tx.add(new MockTransactionLogRecord().failRollback());
        // rollback swallows errors from individual records
        await tx.rollback();
    });

    it('rollback_whenRollingBackCommitFailedTransaction', async () => {
        const options = twoPhaseDurability0();
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        await tx.begin();
        tx.add(new MockTransactionLogRecord().failCommit());
        try {
            await tx.commit();
            throw new Error('Expected TransactionException');
        } catch (e) {
            expect(e).toBeInstanceOf(TransactionException);
        }
        await tx.rollback();
        expect(tx.getState()).toBe(State.ROLLED_BACK);
    });
});
