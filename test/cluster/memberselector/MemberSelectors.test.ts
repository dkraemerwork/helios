/**
 * Port of com.hazelcast.cluster.memberselector.MemberSelectorsTest
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';
import type { Member } from '@zenystx/helios-core/cluster/Member';
import {
    DATA_MEMBER_SELECTOR,
    LITE_MEMBER_SELECTOR,
    LOCAL_MEMBER_SELECTOR,
    MemberSelectors,
    NON_LOCAL_MEMBER_SELECTOR,
} from '@zenystx/helios-core/cluster/memberselector/MemberSelectors';
import type { MemberVersion } from '@zenystx/helios-core/version/MemberVersion';
import { beforeEach, describe, expect, spyOn, test } from 'bun:test';

// Minimal mock member for selectors testing
function makeMockMember(opts: { localMember?: boolean; isLiteMember?: boolean } = {}): Member {
    return {
        localMember: () => opts.localMember ?? false,
        isLiteMember: () => opts.isLiteMember ?? false,
        getAddress: () => null as unknown as Address,
        getUuid: () => '',
        getAttributes: () => new Map(),
        getAttribute: (_k: string) => null as unknown as string,
        getVersion: () => null as unknown as MemberVersion,
        getAddressMap: () => new Map(),
        getSocketAddress: () => null as unknown,
        getSocketAddressForQualifier: () => null as unknown,
    } as unknown as Member;
}

describe('MemberSelectorsTest', () => {
    let member: Member;

    beforeEach(() => {
        member = makeMockMember();
    });

    test('testLiteMemberSelector', () => {
        const m = makeMockMember({ isLiteMember: true });
        expect(LITE_MEMBER_SELECTOR.select(m)).toBe(true);
        expect(DATA_MEMBER_SELECTOR.select(m)).toBe(false);
    });

    test('testDataMemberSelector', () => {
        // default: isLiteMember = false
        expect(LITE_MEMBER_SELECTOR.select(member)).toBe(false);
        expect(DATA_MEMBER_SELECTOR.select(member)).toBe(true);
    });

    test('testLocalMemberSelector', () => {
        const m = makeMockMember({ localMember: true });
        expect(LOCAL_MEMBER_SELECTOR.select(m)).toBe(true);
        expect(NON_LOCAL_MEMBER_SELECTOR.select(m)).toBe(false);
    });

    test('testNonLocalMemberSelector', () => {
        // default: localMember = false
        expect(LOCAL_MEMBER_SELECTOR.select(member)).toBe(false);
        expect(NON_LOCAL_MEMBER_SELECTOR.select(member)).toBe(true);
    });

    test('testAndMemberSelector', () => {
        // localMember=true, isLiteMember=false → AND should be false
        const m = makeMockMember({ localMember: true });
        const localSpy = spyOn(m, 'localMember');
        const liteSpy = spyOn(m, 'isLiteMember');
        const selector = MemberSelectors.and(LOCAL_MEMBER_SELECTOR, LITE_MEMBER_SELECTOR);
        expect(selector.select(m)).toBe(false);
        expect(localSpy).toHaveBeenCalled();
        expect(liteSpy).toHaveBeenCalled();
    });

    test('testAndMemberSelector2', () => {
        // localMember=false → AND short-circuits, isLiteMember should NOT be called
        const m = makeMockMember({ localMember: false });
        const localSpy = spyOn(m, 'localMember');
        const liteSpy = spyOn(m, 'isLiteMember');
        const selector = MemberSelectors.and(LOCAL_MEMBER_SELECTOR, LITE_MEMBER_SELECTOR);
        expect(selector.select(m)).toBe(false);
        expect(localSpy).toHaveBeenCalled();
        expect(liteSpy).not.toHaveBeenCalled();
    });

    test('testAndMemberSelector3', () => {
        // localMember=true, isLiteMember=true → AND should be true
        const m = makeMockMember({ localMember: true, isLiteMember: true });
        const localSpy = spyOn(m, 'localMember');
        const liteSpy = spyOn(m, 'isLiteMember');
        const selector = MemberSelectors.and(LOCAL_MEMBER_SELECTOR, LITE_MEMBER_SELECTOR);
        expect(selector.select(m)).toBe(true);
        expect(localSpy).toHaveBeenCalled();
        expect(liteSpy).toHaveBeenCalled();
    });

    test('testOrMemberSelector', () => {
        // localMember=true → OR short-circuits, isLiteMember should NOT be called
        const m = makeMockMember({ localMember: true });
        const localSpy = spyOn(m, 'localMember');
        const liteSpy = spyOn(m, 'isLiteMember');
        const selector = MemberSelectors.or(LOCAL_MEMBER_SELECTOR, LITE_MEMBER_SELECTOR);
        expect(selector.select(m)).toBe(true);
        expect(localSpy).toHaveBeenCalled();
        expect(liteSpy).not.toHaveBeenCalled();
    });

    test('testOrMemberSelector2', () => {
        // localMember=false, isLiteMember=false → OR should be false
        const m = makeMockMember({ localMember: false, isLiteMember: false });
        const localSpy = spyOn(m, 'localMember');
        const liteSpy = spyOn(m, 'isLiteMember');
        const selector = MemberSelectors.or(LOCAL_MEMBER_SELECTOR, LITE_MEMBER_SELECTOR);
        expect(selector.select(m)).toBe(false);
        expect(localSpy).toHaveBeenCalled();
        expect(liteSpy).toHaveBeenCalled();
    });

    test('testOrMemberSelector3', () => {
        // localMember=true, isLiteMember=true → OR short-circuits on first true
        const m = makeMockMember({ localMember: true, isLiteMember: true });
        const localSpy = spyOn(m, 'localMember');
        const liteSpy = spyOn(m, 'isLiteMember');
        const selector = MemberSelectors.or(LOCAL_MEMBER_SELECTOR, LITE_MEMBER_SELECTOR);
        expect(selector.select(m)).toBe(true);
        expect(localSpy).toHaveBeenCalled();
        expect(liteSpy).not.toHaveBeenCalled();
    });

    test('testOrMemberSelector4', () => {
        // localMember=false, isLiteMember=true → OR returns true after checking both
        const m = makeMockMember({ localMember: false, isLiteMember: true });
        const localSpy = spyOn(m, 'localMember');
        const liteSpy = spyOn(m, 'isLiteMember');
        const selector = MemberSelectors.or(LOCAL_MEMBER_SELECTOR, LITE_MEMBER_SELECTOR);
        expect(selector.select(m)).toBe(true);
        expect(localSpy).toHaveBeenCalled();
        expect(liteSpy).toHaveBeenCalled();
    });
});
