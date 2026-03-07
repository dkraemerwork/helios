/**
 * Port of {@code com.hazelcast.internal.serialization.impl.HeapDataTest}.
 */
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { describe, expect, test } from 'bun:test';

describe('HeapDataTest', () => {
    test('totalSize_whenNonEmpty', () => {
        const heapData = new HeapData(Buffer.allocUnsafe(10));
        expect(heapData.totalSize()).toBe(10);
    });

    test('totalSize_whenEmpty', () => {
        const heapData = new HeapData(Buffer.alloc(0));
        expect(heapData.totalSize()).toBe(0);
    });

    test('totalSize_whenNullByteArray', () => {
        const heapData = new HeapData(null);
        expect(heapData.totalSize()).toBe(0);
    });

    test('copyTo', () => {
        const inputBytes = Buffer.from('12345678890', 'utf8');
        const heap = new HeapData(inputBytes);
        const bytes = Buffer.allocUnsafe(inputBytes.length);
        heap.copyTo(bytes, 0);
        expect(bytes.toString('utf8')).toBe(inputBytes.toString('utf8'));
    });
});
