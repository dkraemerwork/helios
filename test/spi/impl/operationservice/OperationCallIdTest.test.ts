/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.OperationCallIdTest}.
 *
 * Tests for Operation call ID lifecycle management.
 */
import { describe, it, expect } from 'bun:test';
import { Operation } from '@helios/spi/impl/operationservice/Operation';

/** Concrete test operation — run() is a no-op. */
class TestOp extends Operation {
    async run(): Promise<void> { /* no-op */ }
}

describe('Operation.callId', () => {
    it('default callId is 0 (operation is inactive)', () => {
        const op = new TestOp();
        expect(op.getCallId()).toBe(0n);
        expect(op.isActive()).toBe(false);
    });

    it('setting a positive callId makes the operation active', () => {
        const op = new TestOp();
        op.setCallId(1n);
        expect(op.getCallId()).toBe(1n);
        expect(op.isActive()).toBe(true);
    });

    it('setting callId to 0 throws', () => {
        const op = new TestOp();
        expect(() => op.setCallId(0n)).toThrow();
    });

    it('setting callId to a negative value throws', () => {
        const op = new TestOp();
        expect(() => op.setCallId(-1n)).toThrow();
    });

    it('setting callId when already active throws', () => {
        const op = new TestOp();
        op.setCallId(1n);
        expect(() => op.setCallId(2n)).toThrow();
    });

    it('deactivate resets callId to 0 (operation becomes inactive)', () => {
        const op = new TestOp();
        op.setCallId(42n);
        expect(op.isActive()).toBe(true);

        op.deactivate();
        expect(op.getCallId()).toBe(0n);
        expect(op.isActive()).toBe(false);
    });

    it('deactivate on an already-inactive operation is safe (no throw)', () => {
        const op = new TestOp();
        expect(() => op.deactivate()).not.toThrow();
        expect(op.isActive()).toBe(false);
    });

    it('after deactivate, callId can be set again', () => {
        const op = new TestOp();
        op.setCallId(1n);
        op.deactivate();
        // deactivated → can assign a fresh callId
        op.setCallId(2n);
        expect(op.getCallId()).toBe(2n);
        expect(op.isActive()).toBe(true);
    });
});
