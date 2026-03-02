/**
 * Port of com.hazelcast.internal.cluster.impl.MemberSelectingIteratorTest
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { MemberImpl } from '@helios/cluster/impl/MemberImpl';
import { Address } from '@helios/cluster/Address';
import { MemberVersion } from '@helios/version/MemberVersion';
import { MemberSelectingCollection } from '@helios/internal/cluster/impl/MemberSelectingCollection';
import {
    DATA_MEMBER_SELECTOR,
    LITE_MEMBER_SELECTOR,
    NON_LOCAL_MEMBER_SELECTOR,
    MemberSelectors,
} from '@helios/cluster/memberselector/MemberSelectors';
import { BuildInfoProvider } from '@helios/instance/BuildInfoProvider';

const VERSION = MemberVersion.of(BuildInfoProvider.getBuildInfo().getVersion());

function newMember(port: number, opts: { local?: boolean; lite?: boolean } = {}): MemberImpl {
    return new MemberImpl.Builder(new Address('127.0.0.1', port))
        .version(VERSION)
        .uuid(crypto.randomUUID())
        .localMember(opts.local ?? false)
        .liteMember(opts.lite ?? false)
        .build();
}

describe('MemberSelectingIteratorTest', () => {
    let thisMember: MemberImpl;
    let matchingMember: MemberImpl;
    let matchingMember2: MemberImpl;
    let nonMatchingMember: MemberImpl;

    beforeEach(() => {
        thisMember = newMember(5701, { local: true, lite: true });
        matchingMember = newMember(5702, { lite: true });
        matchingMember2 = newMember(5703, { lite: true });
        nonMatchingMember = newMember(5704);
    });

    function createMembers(): MemberImpl[] {
        return [thisMember, matchingMember, nonMatchingMember, matchingMember2];
    }

    test('testSelectingLiteMembersWithThisAddress', () => {
        const membersList = createMembers();
        const filteredMembers = new Set<MemberImpl>();
        for (const m of new MemberSelectingCollection(membersList, LITE_MEMBER_SELECTOR)) {
            filteredMembers.add(m);
        }

        expect(filteredMembers.size).toBe(3);
        expect(filteredMembers.has(thisMember)).toBe(true);
        expect(filteredMembers.has(matchingMember)).toBe(true);
        expect(filteredMembers.has(matchingMember2)).toBe(true);
    });

    test('testSelectingLiteMembersWithoutThisAddress', () => {
        const membersList = createMembers();
        const filteredMembers = new Set<MemberImpl>();
        for (const m of new MemberSelectingCollection(
            membersList,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        )) {
            filteredMembers.add(m);
        }

        expect(filteredMembers.size).toBe(2);
        expect(filteredMembers.has(matchingMember)).toBe(true);
        expect(filteredMembers.has(matchingMember2)).toBe(true);
    });

    test('testSelectingMembersWithThisAddress', () => {
        const membersList = createMembers();
        const filteredMembers = new Set<MemberImpl>();
        for (const m of new MemberSelectingCollection(membersList, DATA_MEMBER_SELECTOR)) {
            filteredMembers.add(m);
        }

        expect(filteredMembers.size).toBe(1);
        expect(filteredMembers.has(nonMatchingMember)).toBe(true);
    });

    test('testSelectingMembersWithoutThisAddress', () => {
        const membersList = createMembers();
        const filteredMembers = new Set<MemberImpl>();
        for (const m of new MemberSelectingCollection(
            membersList,
            MemberSelectors.and(DATA_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        )) {
            filteredMembers.add(m);
        }

        expect(filteredMembers.size).toBe(1);
        expect(filteredMembers.has(nonMatchingMember)).toBe(true);
    });

    test('testHasNextCalledTwice', () => {
        const membersList = createMembers();
        const collection = new MemberSelectingCollection(
            membersList,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        const iterator = collection[Symbol.iterator]();

        let result = iterator.next();
        while (!result.done) {
            // call hasNext equivalent twice (advance once more before consuming)
            iterator.next();
            result = iterator.next();
        }
        // No exception expected
    });

    test('testIterationFailsAfterConsumed', () => {
        const membersList = createMembers();
        const collection = new MemberSelectingCollection(
            membersList,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );

        // consume all via the same iterator
        const iter = collection[Symbol.iterator]() as Iterator<MemberImpl> & { next(): IteratorResult<MemberImpl> };
        let r = iter.next();
        while (!r.done) { r = iter.next(); }

        // calling next() on the same exhausted iterator should throw NoSuchElementException
        expect(() => iter.next()).toThrow();
    });
});
