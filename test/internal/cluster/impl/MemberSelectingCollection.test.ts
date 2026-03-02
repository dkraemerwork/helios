/**
 * Port of com.hazelcast.internal.cluster.impl.MemberSelectingCollectionTest
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
import type { MemberSelector } from '@helios/cluster/MemberSelector';

const NO_OP_MEMBER_SELECTOR: MemberSelector = { select: (_m) => true };

function newMember(port: number, opts: { local?: boolean; lite?: boolean } = {}): MemberImpl {
    return new MemberImpl.Builder(new Address('127.0.0.1', port))
        .version(MemberVersion.of('3.8.0'))
        .uuid(crypto.randomUUID())
        .localMember(opts.local ?? false)
        .liteMember(opts.lite ?? false)
        .build();
}

function assertContains(
    collection: MemberSelectingCollection<MemberImpl>,
    item: MemberImpl,
): void {
    expect(collection.contains(item)).toBe(true);
}

function assertContainsAll(
    collection: MemberSelectingCollection<MemberImpl>,
    items: MemberImpl[],
): void {
    expect(collection.containsAll(items)).toBe(true);
}

function assertNotContainsAll(
    collection: MemberSelectingCollection<MemberImpl>,
    items: MemberImpl[],
): void {
    expect(collection.containsAll(items)).toBe(false);
}

describe('MemberSelectingCollectionTest', () => {
    let thisMember: MemberImpl;
    let liteMember: MemberImpl;
    let dataMember: MemberImpl;
    let nonExistingMember: MemberImpl;
    let members: MemberImpl[];

    beforeEach(() => {
        thisMember = newMember(5701, { local: true, lite: true });
        liteMember = newMember(5702, { lite: true });
        dataMember = newMember(5704);
        nonExistingMember = newMember(5705);
        members = [liteMember, thisMember, dataMember];
    });

    test('testSizeWhenAllSelected', () => {
        const collection = new MemberSelectingCollection(members, NO_OP_MEMBER_SELECTOR);
        expect(collection.size()).toBe(3);
    });

    test('testContainsWhenAllSelected', () => {
        const collection = new MemberSelectingCollection(members, NO_OP_MEMBER_SELECTOR);
        assertContains(collection, liteMember);
        assertContains(collection, thisMember);
        assertContains(collection, dataMember);
    });

    // ##### IS EMPTY #####

    test('testIsEmptyWhenNoMemberIsSelected', () => {
        const subset = members.filter(m => m !== dataMember);
        const collection = new MemberSelectingCollection(
            subset,
            MemberSelectors.and(DATA_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        expect(collection.isEmpty()).toBe(true);
    });

    test('testIsEmptyWhenLiteMembersSelectedAndNoLocalMember', () => {
        const subset = [thisMember]; // removed liteMember and dataMember
        const collection = new MemberSelectingCollection(
            subset,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        expect(collection.isEmpty()).toBe(true);
    });

    // ##### CONTAINS #####

    test('testContainsThisMemberWhenLiteMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        assertContains(collection, thisMember);
    });

    test('testDoesNotContainThisMemberWhenDataMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, DATA_MEMBER_SELECTOR);
        expect(collection.contains(thisMember)).toBe(false);
    });

    test('testDoesNotContainThisMemberWhenLiteMembersSelectedAndNoLocalMember', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        expect(collection.contains(thisMember)).toBe(false);
    });

    test('testDoesNotContainThisMemberDataMembersSelectedAndNoLocalMember', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(DATA_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        expect(collection.contains(thisMember)).toBe(false);
    });

    test('testContainsMatchingMemberWhenLiteMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        assertContains(collection, liteMember);
    });

    test('testContainsMatchingMemberWhenLiteMembersSelectedAndNoLocalMember', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        assertContains(collection, liteMember);
    });

    test('testDoesNotContainNonMatchingMemberWhenLiteMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        expect(collection.contains(dataMember)).toBe(false);
    });

    test('testDoesNotContainNonMatchingMemberWhenLiteMembersSelectedAndNoLocalMember', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        expect(collection.contains(dataMember)).toBe(false);
    });

    test('testDoesNotContainOtherMemberWhenDataMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, DATA_MEMBER_SELECTOR);
        expect(collection.contains(nonExistingMember)).toBe(false);
    });

    test('testDoesNotContainOtherMemberWhenLiteMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        expect(collection.contains(nonExistingMember)).toBe(false);
    });

    // ##### CONTAINS ALL #####

    test('testContainsAllWhenLiteMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        assertContainsAll(collection, [thisMember, liteMember]);
    });

    test('testDoesNotContainAllWhenLiteMembersSelectedAndNoLocalMember', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        assertNotContainsAll(collection, [thisMember, liteMember]);
    });

    test('testDoesNotContainNonMatchingMemberTypesWhenLiteMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        assertNotContainsAll(collection, [thisMember, dataMember]);
    });

    // ##### SIZE #####

    test('testSizeWhenThisLiteMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        expect(collection.size()).toBe(2);
    });

    test('testSizeWhenLiteMembersSelectedAndNoLocalMember', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        expect(collection.size()).toBe(1);
    });

    test('testSizeWhenDataMembersSelectedAndNoLocalMember', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(DATA_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        expect(collection.size()).toBe(1);
    });

    test('testSizeWhenDataMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, DATA_MEMBER_SELECTOR);
        expect(collection.size()).toBe(1);
    });

    // ##### TO ARRAY #####

    function assertArray(collection: MemberSelectingCollection<MemberImpl>, array: MemberImpl[]): void {
        let i = 0;
        for (const member of collection) {
            expect(member).toEqual(array[i++]);
        }
    }

    test('testToArrayWhenLiteMembersSelected', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        const array = collection.toArray();
        assertArray(collection, array);
    });

    test('testToArrayWhenLiteMembersSelected2', () => {
        const collection = new MemberSelectingCollection(members, LITE_MEMBER_SELECTOR);
        const array = collection.toArray();
        assertArray(collection, array);
    });

    test('testToArrayWhenLiteMembersSelectedAndNoLocalMember', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        const array = collection.toArray();
        assertArray(collection, array);
    });

    test('testToArrayWhenLiteMembersSelectedAndNoLocalMember2', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        const array = collection.toArray();
        assertArray(collection, array);
    });

    test('testToArrayWhenLiteMembersFilteredAndNoLocalMember3', () => {
        const collection = new MemberSelectingCollection(
            members,
            MemberSelectors.and(LITE_MEMBER_SELECTOR, NON_LOCAL_MEMBER_SELECTOR),
        );
        const array = collection.toArray();
        assertArray(collection, array);
    });
});
