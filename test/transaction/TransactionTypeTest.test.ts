/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionTypeTest}.
 */
import { TransactionType } from '@zenystx/helios-core/transaction/TransactionOptions';
import { describe, expect, it } from 'bun:test';

describe('TransactionTypeTest', () => {
    it('getById_returns_matching_transactionType', () => {
        for (const txType of TransactionType.values()) {
            expect(TransactionType.getById(txType.id())).toBe(txType);
        }
    });
});
