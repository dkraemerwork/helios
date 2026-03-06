import { describe, test, expect } from 'bun:test';
import { ArrayRingbuffer } from '@zenystx/helios-core/ringbuffer/impl/ArrayRingbuffer';
import { StaleSequenceException } from '@zenystx/helios-core/ringbuffer/StaleSequenceException';

function fullRingbuffer(): ArrayRingbuffer<string> {
    const rb = new ArrayRingbuffer<string>(5);
    for (let i = 0; i < rb.getCapacity(); i++) {
        rb.add('');
    }
    return rb;
}

describe('ArrayRingbufferTest', () => {
    test('testReadStaleSequenceThrowsException', () => {
        const rb = fullRingbuffer();
        expect(() => rb.read(rb.headSequence() - 1)).toThrow(StaleSequenceException);
    });

    test('testReadFutureSequenceThrowsException', () => {
        const rb = fullRingbuffer();
        expect(() => rb.read(rb.tailSequence() + 1)).toThrow(Error);
    });

    test('testBlockableReadStaleSequenceThrowsException', () => {
        const rb = fullRingbuffer();
        expect(() => rb.checkBlockableReadSequence(rb.headSequence() - 1)).toThrow(StaleSequenceException);
    });

    test('testBlockableReadFutureSequenceOk', () => {
        const rb = fullRingbuffer();
        expect(() => rb.checkBlockableReadSequence(rb.tailSequence() + 1)).not.toThrow();
    });

    test('testBlockableReadFutureSequenceThrowsException', () => {
        const rb = fullRingbuffer();
        expect(() => rb.checkBlockableReadSequence(rb.tailSequence() + 2)).toThrow(Error);
    });

    test('testIsEmpty', () => {
        const rb = new ArrayRingbuffer<string>(5);
        expect(rb.isEmpty()).toBe(true);
        rb.add('');
        expect(rb.isEmpty()).toBe(false);
    });

    test('testPeekNextSequenceNumberReturnsTheNext', () => {
        const rb = new ArrayRingbuffer<string>(5);
        const nextTailSequence = rb.peekNextTailSequence();
        const sequenceAdded = rb.add('');
        expect(sequenceAdded).toBe(nextTailSequence);
    });
});
