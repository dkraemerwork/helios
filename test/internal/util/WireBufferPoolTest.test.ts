import { wireBufferPool, WireBufferPool } from '@zenystx/helios-core/internal/util/WireBufferPool';
import { describe, expect, test } from 'bun:test';

describe('WireBufferPool', () => {
    test('reuses output buffers without shrinking grown capacity', () => {
        const pool = new WireBufferPool();
        const out = pool.takeOutputBuffer();
        out.writeByteArray(Buffer.alloc(40_000, 7));
        const grownCapacity = out.getBufferLength();

        pool.returnOutputBuffer(out);

        const reused = pool.takeOutputBuffer();
        expect(reused).toBe(out);
        expect(reused.position()).toBe(0);
        expect(reused.getBufferLength()).toBe(grownCapacity);
    });

    test('reuses input buffers across decodes', () => {
        const pool = new WireBufferPool();
        const first = pool.takeInputBuffer(Buffer.from([1, 2, 3]));
        pool.returnInputBuffer(first);

        const reused = pool.takeInputBuffer(Buffer.from([4, 5, 6]));
        expect(reused).toBe(first);
        expect(reused.readUnsignedByte()).toBe(4);
    });

    test('shared singleton can be cleared safely', () => {
        const out = wireBufferPool.takeOutputBuffer();
        wireBufferPool.returnOutputBuffer(out);
        expect(() => wireBufferPool.clear()).not.toThrow();
    });
});
