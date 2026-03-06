import { describe, test, expect } from 'bun:test';
import { OverflowPolicy } from '@zenystx/helios-core/ringbuffer/OverflowPolicy';

describe('OverflowPolicyTest', () => {
    test('test', () => {
        expect(OverflowPolicy.getById(OverflowPolicy.FAIL.getId())).toBe(OverflowPolicy.FAIL);
        expect(OverflowPolicy.getById(OverflowPolicy.OVERWRITE.getId())).toBe(OverflowPolicy.OVERWRITE);
        expect(OverflowPolicy.getById(-1)).toBeNull();
    });
});
