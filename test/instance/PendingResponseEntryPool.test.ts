import { PendingResponseEntryPool } from '@zenystx/helios-core/instance/impl/PendingResponseEntryPool';
import { describe, expect, test } from 'bun:test';

describe('PendingResponseEntryPool', () => {
    test('reuses pooled entries and clears callback references on release', () => {
        const pool = new PendingResponseEntryPool();
        const resolve = () => {};
        const reject = () => {};
        const entry = pool.take(resolve, reject, 25, 100);

        pool.release(entry);

        expect(entry.resolve).toBeNull();
        expect(entry.reject).toBeNull();
        expect(entry.createdAt).toBe(0);
        expect(entry.timeoutMs).toBe(0);

        const reused = pool.take(resolve, reject, 50, 200);
        expect(reused).toBe(entry);
        expect(reused.createdAt).toBe(200);
        expect(reused.timeoutMs).toBe(50);
    });
});
