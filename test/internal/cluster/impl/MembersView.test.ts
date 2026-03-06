/**
 * Port of com.hazelcast.internal.cluster.impl.MembersViewTest
 */
import { describe, test, expect } from 'bun:test';
import { MemberImpl } from '@zenystx/core/cluster/impl/MemberImpl';
import { MemberInfo } from '@zenystx/core/cluster/MemberInfo';
import { MembersView } from '@zenystx/core/internal/cluster/impl/MembersView';
import { newMember, newMembers } from './MemberMap.test';

describe('MembersViewTest', () => {
    function assertMembersViewEquals(members: MemberImpl[], view: MembersView): void {
        expect(view.size()).toBe(members.length);
        const infos = view.getMembers();
        for (let i = 0; i < members.length; i++) {
            expect(infos[i].toMember().equals(members[i])).toBe(true);
        }
    }

    test('createNew', () => {
        const version = 7;
        const members = newMembers(5);
        const view = MembersView.createNew(version, members);

        expect(view.getVersion()).toBe(version);
        assertMembersViewEquals(members, view);
    });

    test('cloneAdding', () => {
        const version = 6;
        const members = newMembers(4);
        const additionalMembers = [
            new MemberInfo(newMember(6000)),
            new MemberInfo(newMember(7000)),
        ];

        const view = MembersView.cloneAdding(
            MembersView.createNew(version, members),
            additionalMembers,
        );

        expect(view.getVersion()).toBe(version + additionalMembers.length);

        const newMembersList = [
            ...members,
            ...additionalMembers.map(mi => mi.toMember()),
        ];

        assertMembersViewEquals(newMembersList, view);
    });

    test('toMemberMap', () => {
        const version = 5;
        const members = newMembers(3);
        const view = MembersView.createNew(version, members);

        const memberMap = view.toMemberMap();

        expect(memberMap.getVersion()).toBe(version);
        assertMembersViewEquals([...memberMap.getMembers()], view);
    });

    test('containsAddress', () => {
        const members = newMembers(3);
        const view = MembersView.createNew(1, members);

        for (const member of members) {
            expect(view.containsAddress(member.getAddress())).toBe(true);
        }
    });

    test('containsMember', () => {
        const members = newMembers(3);
        const view = MembersView.createNew(1, members);

        for (const member of members) {
            expect(view.containsMember(member.getAddress(), member.getUuid())).toBe(true);
        }
    });

    test('getAddresses', () => {
        const members = newMembers(3);
        const view = MembersView.createNew(1, members);

        const addresses = view.getAddresses();
        expect(addresses.size).toBe(members.length);

        for (const member of members) {
            let found = false;
            for (const addr of addresses) {
                if (addr.equals(member.getAddress())) { found = true; break; }
            }
            expect(found).toBe(true);
        }
    });

    test('getMember', () => {
        const members = newMembers(3);
        const view = MembersView.createNew(1, members);

        const memberInfo = view.getMember(members[0].getAddress());
        expect(memberInfo).not.toBeNull();
        expect(memberInfo!.getUuid()).toBe(members[0].getUuid());
    });

    test('isLaterThan', () => {
        const view1 = MembersView.createNew(1, newMembers(5));
        const view2 = MembersView.createNew(3, newMembers(5));
        const view3 = MembersView.createNew(5, newMembers(5));

        expect(view2.isLaterThan(view1)).toBe(true);
        expect(view3.isLaterThan(view1)).toBe(true);
        expect(view3.isLaterThan(view2)).toBe(true);

        expect(view1.isLaterThan(view1)).toBe(false);
        expect(view1.isLaterThan(view2)).toBe(false);
        expect(view1.isLaterThan(view3)).toBe(false);

        expect(view2.isLaterThan(view2)).toBe(false);
        expect(view2.isLaterThan(view3)).toBe(false);

        expect(view3.isLaterThan(view3)).toBe(false);
    });
});
