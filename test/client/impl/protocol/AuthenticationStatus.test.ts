/**
 * Port of com.hazelcast.client.impl.protocol.AuthenticationStatusTest
 */
import { AuthenticationStatus } from '@zenystx/helios-core/client/impl/protocol/AuthenticationStatus';
import { describe, expect, it } from 'bun:test';

describe('AuthenticationStatus', () => {
    it('testGetId — AUTHENTICATED=0, CREDENTIALS_FAILED=1, SERIALIZATION_VERSION_MISMATCH=2', () => {
        expect(AuthenticationStatus.AUTHENTICATED.getId()).toBe(0);
        expect(AuthenticationStatus.CREDENTIALS_FAILED.getId()).toBe(1);
        expect(AuthenticationStatus.SERIALIZATION_VERSION_MISMATCH.getId()).toBe(2);
    });

    it('testGetById — known ids', () => {
        expect(AuthenticationStatus.getById(0)).toBe(AuthenticationStatus.AUTHENTICATED);
        expect(AuthenticationStatus.getById(1)).toBe(AuthenticationStatus.CREDENTIALS_FAILED);
        expect(AuthenticationStatus.getById(2)).toBe(AuthenticationStatus.SERIALIZATION_VERSION_MISMATCH);
        expect(AuthenticationStatus.getById(3)).toBe(AuthenticationStatus.NOT_ALLOWED_IN_CLUSTER);
    });

    it('testGetById_invalidId — throws for unknown id', () => {
        expect(() => AuthenticationStatus.getById(99)).toThrow();
    });
});
