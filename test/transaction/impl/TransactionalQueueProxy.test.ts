import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import { State } from '@zenystx/helios-core/transaction/impl/Transaction.js';
import type { TransactionImpl } from '@zenystx/helios-core/transaction/impl/TransactionImpl.js';
import { TransactionalQueueProxy } from '@zenystx/helios-core/transaction/impl/TransactionalQueueProxy.js';
import { describe, expect, it } from 'bun:test';

function makeNodeEngine(): NodeEngine {
    return {
        toData: (value: unknown) => value as Data,
        toObject: <T>(value: unknown) => value as T,
    } as unknown as NodeEngine;
}

function makeTransaction(logRecords: unknown[]): TransactionImpl {
    return {
        add: (record: unknown) => {
            logRecords.push(record);
        },
        getState: () => State.ACTIVE,
    } as unknown as TransactionImpl;
}

describe('TransactionalQueueProxy', () => {
    it('advances the logical read cursor for committed queue items', async () => {
        const committedItems = ['first', 'second', 'third'];
        const logRecords: unknown[] = [];
        const proxy = new TransactionalQueueProxy(
            'tx-queue',
            makeTransaction(logRecords),
            makeNodeEngine(),
            {
                offer: async (element) => {
                    committedItems.push(element);
                    return true;
                },
                poll: async () => committedItems.shift() ?? null,
                peek: async () => committedItems[0] ?? null,
                size: async () => committedItems.length,
                toArray: async () => [...committedItems],
            },
        );

        expect(await proxy.poll()).toBe('first');
        expect(await proxy.poll()).toBe('second');
        expect(await proxy.peek()).toBe('third');
        expect(await proxy.size()).toBe(1);
        expect(committedItems).toEqual(['first', 'second', 'third']);
        expect(logRecords).toHaveLength(2);
    });

    it('returns null once pending polls exhaust committed contents', async () => {
        const committedItems = ['only'];
        const proxy = new TransactionalQueueProxy(
            'tx-queue',
            makeTransaction([]),
            makeNodeEngine(),
            {
                offer: async (element) => {
                    committedItems.push(element);
                    return true;
                },
                poll: async () => committedItems.shift() ?? null,
                peek: async () => committedItems[0] ?? null,
                size: async () => committedItems.length,
                toArray: async () => [...committedItems],
            },
        );

        expect(await proxy.poll()).toBe('only');
        expect(await proxy.peek()).toBeNull();
        expect(await proxy.poll()).toBeNull();
        expect(await proxy.size()).toBe(0);
    });
});
