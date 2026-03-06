import { describe, it, expect } from 'bun:test';
import { InstancePermission } from '@zenystx/core/security/permission/InstancePermission';

/** Concrete subclass for testing — mirrors Java InstantiatableInstancePermission */
class TestInstancePermission extends InstancePermission {
    constructor(name: string | null | undefined, ...actions: string[]) {
        super(name as string, ...actions);
    }
    protected initMask(_actions: string[]): number {
        return Number.MIN_SAFE_INTEGER;
    }
}

describe('InstancePermissionTest', () => {
    it('testActions', () => {
        const p = new TestInstancePermission('TestClass', 'A', 'B', 'C');
        expect(p.getActions()).toBe('A B C');
    });

    it('testInvalidNameThrows — null', () => {
        expect(() => new TestInstancePermission(null)).toThrow();
    });

    it('testInvalidNameThrows — empty string', () => {
        expect(() => new TestInstancePermission('')).toThrow();
    });
});
