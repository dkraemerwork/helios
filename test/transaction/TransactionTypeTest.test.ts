/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionTypeTest}.
 */
import { describe, it, expect } from 'bun:test';
import { TransactionType } from '@helios/transaction/TransactionOptions';

describe('TransactionTypeTest', () => {
    it('getById_returns_matching_transactionType', () => {
        for (const txType of TransactionType.values()) {
            expect(TransactionType.getById(txType.id())).toBe(txType);
        }
    });
});
