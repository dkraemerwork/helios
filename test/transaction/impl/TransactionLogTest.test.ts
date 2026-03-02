/**
 * Port of {@code com.hazelcast.transaction.impl.TransactionLogTest}.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { TransactionLog } from '@helios/transaction/impl/TransactionLog';
import type { TransactionLogRecord } from '@helios/transaction/impl/TransactionLogRecord';
import type { TargetAwareTransactionLogRecord } from '@helios/transaction/impl/TargetAwareTransactionLogRecord';
import type { NodeEngine } from '@helios/spi/NodeEngine';
import type { OperationService } from '@helios/spi/impl/operationservice/OperationService';
import { Operation, GENERIC_PARTITION_ID } from '@helios/spi/impl/operationservice/Operation';
import { InvocationFuture } from '@helios/spi/impl/operationservice/InvocationFuture';
import { Address } from '@helios/cluster/Address';

// ── Helpers ───────────────────────────────────────────────────────────────────

class DummyPartitionOperation extends Operation {
    constructor() {
        super();
        this.serviceName = 'dummy';
        this.partitionId = 0;
    }
    async run(): Promise<void> {}
}

class DummyTargetOperation extends Operation {
    constructor() {
        super();
        this.serviceName = 'dummy';
        // generic partition (not partition-specific)
        this.partitionId = GENERIC_PARTITION_ID;
    }
    async run(): Promise<void> {}
}

/** Create a mock OperationService that records calls */
function makeMockOperationService() {
    const invokeOnPartitionCalls: unknown[][] = [];
    const invokeOnTargetCalls: unknown[][] = [];

    const completedFuture = (): InvocationFuture<unknown> => {
        const f = new InvocationFuture<unknown>();
        f.complete(undefined);
        return f;
    };

    const svc: OperationService = {
        run: mock(async (_op: Operation) => {}),
        execute: mock((_op: Operation) => {}),
        invokeOnPartition: mock((svcName: string, op: Operation, pid: number) => {
            invokeOnPartitionCalls.push([svcName, op, pid]);
            return completedFuture();
        }) as OperationService['invokeOnPartition'],
        invokeOnTarget: mock((svcName: string, op: Operation, target: Address) => {
            invokeOnTargetCalls.push([svcName, op, target]);
            return completedFuture();
        }) as OperationService['invokeOnTarget'],
    };

    return { svc, invokeOnPartitionCalls, invokeOnTargetCalls };
}

/** Create a mock NodeEngine returning the given OperationService */
function makeMockNodeEngine(operationService: OperationService): NodeEngine {
    return {
        getOperationService: () => operationService,
    } as unknown as NodeEngine;
}

/** Create a mock TransactionLogRecord (key-aware) */
function mockKeyRecord(key: unknown, op: Operation): TransactionLogRecord {
    return {
        getKey: () => key,
        newPrepareOperation: () => op,
        newCommitOperation: () => op,
        newRollbackOperation: () => op,
        onCommitSuccess: () => {},
        onCommitFailure: () => {},
    };
}

/** Create a mock TransactionLogRecord (no key) */
function mockNoKeyRecord(op: Operation): TransactionLogRecord {
    return {
        getKey: () => null,
        newPrepareOperation: () => op,
        newCommitOperation: () => op,
        newRollbackOperation: () => op,
        onCommitSuccess: () => {},
        onCommitFailure: () => {},
    };
}

/** Create a mock TargetAwareTransactionLogRecord */
function mockTargetRecord(target: Address, op: Operation): TargetAwareTransactionLogRecord {
    return {
        getKey: () => null,
        getTarget: () => target,
        newPrepareOperation: () => op,
        newCommitOperation: () => op,
        newRollbackOperation: () => op,
        onCommitSuccess: () => {},
        onCommitFailure: () => {},
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TransactionLogTest', () => {
    // ── add ──────────────────────────────────────────────────────────────────

    it('add_whenKeyAware', () => {
        const log = new TransactionLog();
        const op = new DummyPartitionOperation();
        const key = 'foo';
        const record = mockKeyRecord(key, op);

        log.add(record);

        expect(log.get(key)).toBe(record);
        expect(log.size()).toBe(1);
    });

    it('add_whenNotKeyAware', () => {
        const log = new TransactionLog();
        const op = new DummyPartitionOperation();
        const record = mockNoKeyRecord(op);

        log.add(record);

        expect(log.size()).toBe(1);
        expect([...log.getRecords()]).toContain(record);
    });

    it('add_whenOverwrite', () => {
        const log = new TransactionLog();
        const key = 'foo';
        const op1 = new DummyPartitionOperation();
        const oldRecord = mockKeyRecord(key, op1);
        log.add(oldRecord);

        const op2 = new DummyPartitionOperation();
        const newRecord = mockKeyRecord(key, op2);
        log.add(newRecord);

        expect(log.get(key)).toBe(newRecord);
        expect(log.size()).toBe(1);
    });

    // ── remove ───────────────────────────────────────────────────────────────

    it('remove_whenNotExist_thenCallIgnored', () => {
        const log = new TransactionLog();
        // should not throw
        log.remove('not exist');
    });

    it('remove_whenExist_thenRemoved', () => {
        const log = new TransactionLog();
        const key = 'foo';
        const op = new DummyPartitionOperation();
        const record = mockKeyRecord(key, op);
        log.add(record);

        log.remove(key);

        expect(log.get(key)).toBeNull();
    });

    // ── prepare (partition) ───────────────────────────────────────────────

    it('prepare_partitionSpecificRecord', () => {
        const { svc, invokeOnPartitionCalls } = makeMockOperationService();
        const nodeEngine = makeMockNodeEngine(svc);

        const log = new TransactionLog();
        const partitionOp = new DummyPartitionOperation();
        const partitionRecord = mockNoKeyRecord(partitionOp);

        log.add(partitionRecord);
        log.prepare(nodeEngine);

        expect(invokeOnPartitionCalls.length).toBe(1);
        expect(invokeOnPartitionCalls[0][0]).toBe(partitionOp.serviceName);
        expect(invokeOnPartitionCalls[0][1]).toBe(partitionOp);
        expect(invokeOnPartitionCalls[0][2]).toBe(partitionOp.partitionId);
    });

    // ── rollback (partition) ──────────────────────────────────────────────

    it('rollback_partitionSpecificRecord', () => {
        const { svc, invokeOnPartitionCalls } = makeMockOperationService();
        const nodeEngine = makeMockNodeEngine(svc);

        const log = new TransactionLog();
        const partitionOp = new DummyPartitionOperation();
        const partitionRecord = mockNoKeyRecord(partitionOp);

        log.add(partitionRecord);
        log.rollback(nodeEngine);

        expect(invokeOnPartitionCalls.length).toBe(1);
        expect(invokeOnPartitionCalls[0][0]).toBe(partitionOp.serviceName);
        expect(invokeOnPartitionCalls[0][1]).toBe(partitionOp);
        expect(invokeOnPartitionCalls[0][2]).toBe(partitionOp.partitionId);
    });

    // ── commit (partition) ────────────────────────────────────────────────

    it('commit_partitionSpecificRecord', () => {
        const { svc, invokeOnPartitionCalls } = makeMockOperationService();
        const nodeEngine = makeMockNodeEngine(svc);

        const log = new TransactionLog();
        const partitionOp = new DummyPartitionOperation();
        const partitionRecord = mockNoKeyRecord(partitionOp);

        log.add(partitionRecord);
        log.commit(nodeEngine);

        expect(invokeOnPartitionCalls.length).toBe(1);
        expect(invokeOnPartitionCalls[0][0]).toBe(partitionOp.serviceName);
        expect(invokeOnPartitionCalls[0][1]).toBe(partitionOp);
        expect(invokeOnPartitionCalls[0][2]).toBe(partitionOp.partitionId);
    });

    // ── prepare (target) ──────────────────────────────────────────────────

    it('prepare_targetAwareRecord', () => {
        const { svc, invokeOnTargetCalls } = makeMockOperationService();
        const nodeEngine = makeMockNodeEngine(svc);

        const log = new TransactionLog();
        const target = new Address('127.0.0.1', 5000);
        const targetOp = new DummyTargetOperation();
        const targetRecord = mockTargetRecord(target, targetOp);

        log.add(targetRecord);
        log.prepare(nodeEngine);

        expect(invokeOnTargetCalls.length).toBe(1);
        expect(invokeOnTargetCalls[0][0]).toBe(targetOp.serviceName);
        expect(invokeOnTargetCalls[0][1]).toBe(targetOp);
        expect(invokeOnTargetCalls[0][2]).toBe(target);
    });

    // ── rollback (target) ─────────────────────────────────────────────────

    it('rollback_targetAwareRecord', () => {
        const { svc, invokeOnTargetCalls } = makeMockOperationService();
        const nodeEngine = makeMockNodeEngine(svc);

        const log = new TransactionLog();
        const target = new Address('127.0.0.1', 5000);
        const targetOp = new DummyTargetOperation();
        const targetRecord = mockTargetRecord(target, targetOp);

        log.add(targetRecord);
        log.rollback(nodeEngine);

        expect(invokeOnTargetCalls.length).toBe(1);
        expect(invokeOnTargetCalls[0][0]).toBe(targetOp.serviceName);
        expect(invokeOnTargetCalls[0][1]).toBe(targetOp);
        expect(invokeOnTargetCalls[0][2]).toBe(target);
    });

    // ── commit (target) ───────────────────────────────────────────────────

    it('commit_targetAwareRecord', () => {
        const { svc, invokeOnTargetCalls } = makeMockOperationService();
        const nodeEngine = makeMockNodeEngine(svc);

        const log = new TransactionLog();
        const target = new Address('127.0.0.1', 5000);
        const targetOp = new DummyTargetOperation();
        const targetRecord = mockTargetRecord(target, targetOp);

        log.add(targetRecord);
        log.commit(nodeEngine);

        expect(invokeOnTargetCalls.length).toBe(1);
        expect(invokeOnTargetCalls[0][0]).toBe(targetOp.serviceName);
        expect(invokeOnTargetCalls[0][1]).toBe(targetOp);
        expect(invokeOnTargetCalls[0][2]).toBe(target);
    });
});
