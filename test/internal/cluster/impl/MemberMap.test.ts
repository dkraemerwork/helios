/**
 * Port of com.hazelcast.internal.cluster.impl.MemberMapTest
 */
import { describe, test, expect } from 'bun:test';
import { MemberImpl } from '@zenystx/core/cluster/impl/MemberImpl';
import { Address } from '@zenystx/core/cluster/Address';
import { MemberVersion } from '@zenystx/core/version/MemberVersion';
import { MemberMap } from '@zenystx/core/internal/cluster/impl/MemberMap';
import { BuildInfoProvider } from '@zenystx/core/instance/BuildInfoProvider';

const VERSION = MemberVersion.of(BuildInfoProvider.getBuildInfo().getVersion());

export function newMembers(count: number): MemberImpl[] {
    const members: MemberImpl[] = [];
    for (let i = 0; i < count; i++) {
        members.push(newMember(5000 + i));
    }
    return members;
}

export function newMember(port: number): MemberImpl {
    return new MemberImpl.Builder(newAddress(port))
        .version(VERSION)
        .uuid(crypto.randomUUID())
        .build();
}

export function newAddress(port: number): Address {
    return new Address('127.0.0.1', port);
}

function assertContainsAddress(map: MemberMap, address: Address): void {
    expect(map.contains(address)).toBe(true);
}

function assertContainsUuid(map: MemberMap, uuid: string): void {
    expect(map.containsUuid(uuid)).toBe(true);
}

function assertNotContainsAddress(map: MemberMap, address: Address): void {
    expect(map.contains(address)).toBe(false);
}

function assertNotContainsUuid(map: MemberMap, uuid: string): void {
    expect(map.containsUuid(uuid)).toBe(false);
}

function assertMemberSet(map: MemberMap): void {
    for (const member of map.getMembers()) {
        assertContainsAddress(map, member.getAddress());
        assertContainsUuid(map, member.getUuid());
        expect(map.getMemberByAddress(member.getAddress())).toBe(member);
        expect(map.getMemberByUuid(member.getUuid())).toBe(member);
    }
}

describe('MemberMapTest', () => {
    test('createEmpty', () => {
        const map = MemberMap.empty();
        expect([...map.getMembers()]).toHaveLength(0);
        expect([...map.getAddresses()]).toHaveLength(0);
        expect(map.size()).toBe(0);
    });

    test('createSingleton', () => {
        const member = newMember(5000);
        const map = MemberMap.singleton(member);
        expect(map.size()).toBe(1);
        expect([...map.getMembers()]).toHaveLength(1);
        expect([...map.getAddresses()]).toHaveLength(1);
        assertContainsAddress(map, member.getAddress());
        assertContainsUuid(map, member.getUuid());
        expect(map.getMemberByAddress(member.getAddress())).toBe(member);
        expect(map.getMemberByUuid(member.getUuid())).toBe(member);
        assertMemberSet(map);
    });

    test('createNew', () => {
        const members = newMembers(5);
        const map = MemberMap.createNew(...members);
        expect(map.size()).toBe(members.length);
        expect([...map.getMembers()]).toHaveLength(members.length);
        expect([...map.getAddresses()]).toHaveLength(members.length);
        for (const member of members) {
            assertContainsAddress(map, member.getAddress());
            assertContainsUuid(map, member.getUuid());
            expect(map.getMemberByAddress(member.getAddress())).toBe(member);
            expect(map.getMemberByUuid(member.getUuid())).toBe(member);
        }
        assertMemberSet(map);
    });

    test('create_failsWithDuplicateAddress', () => {
        const member1 = newMember(5000);
        const member2 = newMember(5000);
        expect(() => MemberMap.createNew(member1, member2)).toThrow();
    });

    test('create_failsWithDuplicateUuid', () => {
        const member1 = newMember(5000);
        const member2 = new MemberImpl.Builder(newAddress(5001))
            .version(VERSION)
            .uuid(member1.getUuid())
            .build();
        expect(() => MemberMap.createNew(member1, member2)).toThrow();
    });

    test('cloneExcluding', () => {
        const members = newMembers(6);
        const exclude0 = members[0];
        const exclude1 = new MemberImpl.Builder(newAddress(6000))
            .version(VERSION)
            .uuid(members[1].getUuid())
            .build();
        const exclude2 = new MemberImpl.Builder(members[2].getAddress())
            .version(VERSION)
            .uuid(crypto.randomUUID())
            .build();

        const map = MemberMap.cloneExcluding(MemberMap.createNew(...members), exclude0, exclude1, exclude2);

        const numOfExcludedMembers = 3;
        expect(map.size()).toBe(members.length - numOfExcludedMembers);
        expect([...map.getMembers()]).toHaveLength(members.length - numOfExcludedMembers);
        expect([...map.getAddresses()]).toHaveLength(members.length - numOfExcludedMembers);

        for (let i = 0; i < numOfExcludedMembers; i++) {
            const member = members[i];
            assertNotContainsAddress(map, member.getAddress());
            assertNotContainsUuid(map, member.getUuid());
            expect(map.getMemberByAddress(member.getAddress())).toBeNull();
            expect(map.getMemberByUuid(member.getUuid())).toBeNull();
        }

        for (let i = numOfExcludedMembers; i < members.length; i++) {
            const member = members[i];
            assertContainsAddress(map, member.getAddress());
            assertContainsUuid(map, member.getUuid());
            expect(map.getMemberByAddress(member.getAddress())).toBe(member);
            expect(map.getMemberByUuid(member.getUuid())).toBe(member);
        }

        assertMemberSet(map);
    });

    test('cloneExcluding_emptyMap', () => {
        const empty = MemberMap.empty();
        const map = MemberMap.cloneExcluding(empty, newMember(5000));
        expect(map.size()).toBe(0);
        expect(map).toBe(empty);
    });

    test('cloneAdding', () => {
        const members = newMembers(5);
        const map = MemberMap.cloneAdding(
            MemberMap.createNew(members[0], members[1], members[2]),
            members[3],
            members[4],
        );
        expect(map.size()).toBe(members.length);
        expect([...map.getMembers()]).toHaveLength(members.length);
        expect([...map.getAddresses()]).toHaveLength(members.length);

        for (const member of members) {
            assertContainsAddress(map, member.getAddress());
            assertContainsUuid(map, member.getUuid());
            expect(map.getMemberByAddress(member.getAddress())).toBe(member);
            expect(map.getMemberByUuid(member.getUuid())).toBe(member);
        }

        assertMemberSet(map);
    });

    test('cloneAdding_failsWithDuplicateAddress', () => {
        const members = newMembers(3);
        const member = newMember(5000);
        expect(() => MemberMap.cloneAdding(MemberMap.createNew(...members), member)).toThrow();
    });

    test('cloneAdding_failsWithDuplicateUuid', () => {
        const members = newMembers(3);
        const member = new MemberImpl.Builder(newAddress(6000))
            .version(VERSION)
            .uuid(members[1].getUuid())
            .build();
        expect(() => MemberMap.cloneAdding(MemberMap.createNew(...members), member)).toThrow();
    });

    test('getMembers_ordered', () => {
        const members = newMembers(10);
        const map = MemberMap.createNew(...members);
        const memberSet = [...map.getMembers()];

        let index = 0;
        for (const member of memberSet) {
            expect(member).toBe(members[index++]);
        }
    });

    test('getMembers_unmodifiable', () => {
        const members = newMembers(5);
        const map = MemberMap.createNew(...members);
        expect(() => (map.getMembers() as unknown as { add: (m: MemberImpl) => void }).add(newMember(9000))).toThrow();
    });

    test('getAddresses_unmodifiable', () => {
        const members = newMembers(5);
        const map = MemberMap.createNew(...members);
        expect(() => (map.getAddresses() as unknown as { add: (a: Address) => void }).add(newAddress(9000))).toThrow();
    });

    test('getMember_withAddressAndUuid_whenFound', () => {
        const members = newMembers(3);
        const map = MemberMap.createNew(...members);

        const member = members[0];
        expect(map.getMember(member.getAddress(), member.getUuid())).toEqual(member);
    });

    test('getMember_withAddressAndUuid_whenOnlyAddressFound', () => {
        const members = newMembers(3);
        const map = MemberMap.createNew(...members);
        expect(map.getMember(members[0].getAddress(), crypto.randomUUID())).toBeNull();
    });

    test('getMember_withAddressAndUuid_whenOnlyUuidFound', () => {
        const members = newMembers(3);
        const map = MemberMap.createNew(...members);
        expect(map.getMember(newAddress(6000), members[0].getUuid())).toBeNull();
    });

    test('getMember_withAddressAndUuid_whenNotFound', () => {
        const members = newMembers(3);
        const map = MemberMap.createNew(...members);
        expect(map.getMember(newAddress(6000), crypto.randomUUID())).toBeNull();
    });

    test('tailMemberSet_inclusive', () => {
        const members = newMembers(7);
        const map = MemberMap.createNew(...members);

        const member = members[3];
        const set = [...map.tailMemberSet(member, true)];

        expect(set).toHaveLength(4);
        let k = 3;
        for (const m of set) {
            expect(m).toEqual(members[k++]);
        }
    });

    test('tailMemberSet_exclusive', () => {
        const members = newMembers(7);
        const map = MemberMap.createNew(...members);

        const member = members[3];
        const set = [...map.tailMemberSet(member, false)];

        expect(set).toHaveLength(3);
        let k = 4;
        for (const m of set) {
            expect(m).toEqual(members[k++]);
        }
    });

    test('headMemberSet_inclusive', () => {
        const members = newMembers(7);
        const map = MemberMap.createNew(...members);

        const member = members[3];
        const set = [...map.headMemberSet(member, true)];

        expect(set).toHaveLength(4);
        let k = 0;
        for (const m of set) {
            expect(m).toEqual(members[k++]);
        }
    });

    test('headMemberSet_exclusive', () => {
        const members = newMembers(7);
        const map = MemberMap.createNew(...members);

        const member = members[3];
        const set = [...map.headMemberSet(member, false)];

        expect(set).toHaveLength(3);
        let k = 0;
        for (const m of set) {
            expect(m).toEqual(members[k++]);
        }
    });

    test('isBeforeThan_success', () => {
        const members = newMembers(5);
        const map = MemberMap.createNew(...members);
        expect(map.isBeforeThan(members[1].getAddress(), members[3].getAddress())).toBe(true);
    });

    test('isBeforeThan_fail', () => {
        const members = newMembers(5);
        const map = MemberMap.createNew(...members);
        expect(map.isBeforeThan(members[4].getAddress(), members[1].getAddress())).toBe(false);
    });

    test('isBeforeThan_whenFirstAddressNotExist', () => {
        const members = newMembers(5);
        const map = MemberMap.createNew(...members);
        // should not throw
        map.isBeforeThan(newAddress(6000), members[0].getAddress());
    });

    test('isBeforeThan_whenSecondAddressNotExist', () => {
        const members = newMembers(5);
        const map = MemberMap.createNew(...members);
        map.isBeforeThan(members[0].getAddress(), newAddress(6000));
    });

    test('isBeforeThan_whenAddressesNotExist', () => {
        const members = newMembers(5);
        const map = MemberMap.createNew(...members);
        map.isBeforeThan(newAddress(6000), newAddress(7000));
    });
});
