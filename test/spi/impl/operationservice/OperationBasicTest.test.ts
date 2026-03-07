/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.OperationTest}.
 *
 * Basic Operation behavior: null-safe sendResponse, replicaIndex validation,
 * GENERIC_PARTITION_ID constant, and default field values.
 */
import { GENERIC_PARTITION_ID, Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { describe, expect, it } from 'bun:test';

class TestOp extends Operation {
    async run(): Promise<void> { /* no-op */ }
}

describe('Operation basics', () => {
    it('sendResponse with null response handler and exception does not throw', () => {
        const op = new TestOp();
        // responseHandler is null by default
        expect(() => op.sendResponse(new Error('boom'))).not.toThrow();
    });

    it('sendResponse with null response handler and normal value does not throw', () => {
        const op = new TestOp();
        expect(() => op.sendResponse('some value')).not.toThrow();
    });

    it('setReplicaIndex with -1 throws', () => {
        const op = new TestOp();
        expect(() => op.setReplicaIndex(-1)).toThrow();
    });

    it('setReplicaIndex with 0 is valid', () => {
        const op = new TestOp();
        op.setReplicaIndex(0);
        expect(op.replicaIndex).toBe(0);
    });

    it('GENERIC_PARTITION_ID constant equals -1', () => {
        expect(GENERIC_PARTITION_ID).toBe(-1);
        expect(Operation.GENERIC_PARTITION_ID).toBe(-1);
    });

    it('default partitionId is GENERIC_PARTITION_ID', () => {
        const op = new TestOp();
        expect(op.partitionId).toBe(GENERIC_PARTITION_ID);
    });
});
