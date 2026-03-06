/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionImplTest}.
 *
 * Tests basic behavior that doesn't require begin/commit/rollback execution.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { TransactionImpl } from '@zenystx/core/transaction/impl/TransactionImpl';
import type { TransactionManagerServiceLike } from '@zenystx/core/transaction/impl/TransactionImpl';
import type { NodeEngine } from '@zenystx/core/spi/NodeEngine';
import { TransactionOptions, TransactionType } from '@zenystx/core/transaction/TransactionOptions';
import { MwCounter } from '@zenystx/core/internal/util/counters/MwCounter';
import { State } from '@zenystx/core/transaction/impl/Transaction';

function makeMockManager(): TransactionManagerServiceLike {
    return {
        startCount:    MwCounter.newMwCounter(),
        commitCount:   MwCounter.newMwCounter(),
        rollbackCount: MwCounter.newMwCounter(),
        pickBackupLogAddresses: (_d: number) => [],
    };
}

function makeMockNodeEngine(): NodeEngine {
    return {
        getLogger: () => ({
            finest: () => {}, fine: () => {}, info: () => {},
            warning: () => {}, severe: () => {},
            isFinestEnabled: () => false, isFineEnabled: () => false,
        }),
        getOperationService: () => { throw new Error('not used'); },
    } as unknown as NodeEngine;
}

describe('TransactionImplTest', () => {
    let manager: TransactionManagerServiceLike;
    let nodeEngine: NodeEngine;
    let options: TransactionOptions;

    beforeEach(() => {
        manager = makeMockManager();
        nodeEngine = makeMockNodeEngine();
        options = new TransactionOptions().setTransactionType(TransactionType.ONE_PHASE);
    });

    it('getTimeoutMillis', () => {
        const tx = new TransactionImpl(manager, nodeEngine, options, crypto.randomUUID());
        expect(tx.getTimeoutMillis()).toBe(options.getTimeoutMillis());
    });

    it('testToString', () => {
        const ownerUUID = crypto.randomUUID();
        const tx = new TransactionImpl(manager, nodeEngine, options, ownerUUID);
        const str = tx.toString();
        expect(str).toContain(tx.getTxnId());
        expect(str).toContain(State.NO_TXN);
        expect(str).toContain(String(options.getTransactionType()));
        expect(str).toContain(String(options.getTimeoutMillis()));
    });

    it('getOwnerUUID', () => {
        const ownerUUID = crypto.randomUUID();
        const tx = new TransactionImpl(manager, nodeEngine, options, ownerUUID);
        expect(tx.getOwnerUuid()).toBe(ownerUUID);
    });
});
