/**
 * Port of com.hazelcast.internal.cluster.impl.AddressCheckerImplTest
 */
import { describe, test, expect } from 'bun:test';
import { Address } from '@helios/cluster/Address';
import { AddressCheckerImpl } from '@helios/internal/cluster/impl/AddressCheckerImpl';

function createAddress(ip: string): Address {
    return new Address(ip, 5701);
}

describe('AddressCheckerImplTest', () => {
    test('givenNoInterfaceIsConfigured_whenMessageArrives_thenTrust', () => {
        const checker = new AddressCheckerImpl(new Set(), null);
        expect(checker.isTrusted(createAddress('127.0.0.1'))).toBe(true);
    });

    test('givenInterfaceIsConfigured_whenMessageWithMatchingHost_thenTrust', () => {
        const checker = new AddressCheckerImpl(new Set(['127.0.0.1']), null);
        expect(checker.isTrusted(createAddress('127.0.0.1'))).toBe(true);
    });

    test('givenInterfaceIsConfigured_whenMessageWithNonMatchingHost_thenDoNotTrust', () => {
        const checker = new AddressCheckerImpl(new Set(['127.0.0.2']), null);
        expect(checker.isTrusted(createAddress('127.0.0.1'))).toBe(false);
    });

    test('givenInterfaceRangeIsConfigured_whenMessageWithMatchingHost_thenTrust', () => {
        const checker = new AddressCheckerImpl(new Set(['127.0.0.1-100']), null);
        expect(checker.isTrusted(createAddress('127.0.0.2'))).toBe(true);
    });

    test('givenInterfaceRangeIsConfigured_whenMessageWithNonMatchingHost_thenDoNotTrust', () => {
        const checker = new AddressCheckerImpl(new Set(['127.0.0.1-100']), null);
        expect(checker.isTrusted(createAddress('127.0.0.101'))).toBe(false);
    });

    test('testAsteriskWildcard', () => {
        let checker = new AddressCheckerImpl(new Set(['127.0.*.*']), null);
        expect(checker.isTrusted(createAddress('127.0.1.1'))).toBe(true);
        expect(checker.isTrusted(createAddress('127.1.1.1'))).toBe(false);

        checker = new AddressCheckerImpl(new Set(['127.*.1.*']), null);
        expect(checker.isTrusted(createAddress('127.0.1.1'))).toBe(true);
        expect(checker.isTrusted(createAddress('127.127.1.127'))).toBe(true);
        expect(checker.isTrusted(createAddress('127.127.127.127'))).toBe(false);
    });

    test('testIntervalRange', () => {
        let checker = new AddressCheckerImpl(new Set(['127.0.110-115.*']), null);
        expect(checker.isTrusted(createAddress('127.0.110.1'))).toBe(true);
        expect(checker.isTrusted(createAddress('127.0.112.1'))).toBe(true);
        expect(checker.isTrusted(createAddress('127.0.115.255'))).toBe(true);
        expect(checker.isTrusted(createAddress('127.0.116.255'))).toBe(false);
        expect(checker.isTrusted(createAddress('127.0.1.1'))).toBe(false);

        checker = new AddressCheckerImpl(new Set(['127.0.110-115.1-2']), null);
        expect(checker.isTrusted(createAddress('127.0.110.2'))).toBe(true);
        expect(checker.isTrusted(createAddress('127.0.110.3'))).toBe(false);
        expect(checker.isTrusted(createAddress('127.0.109.2'))).toBe(false);
    });
});
