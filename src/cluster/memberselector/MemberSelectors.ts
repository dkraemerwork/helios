/**
 * Port of {@code com.hazelcast.cluster.memberselector.MemberSelectors}.
 * Utility class providing built-in MemberSelector instances and factory methods.
 */
import type { MemberSelector } from '@zenystx/helios-core/cluster/MemberSelector';
import { AndMemberSelector } from '@zenystx/helios-core/cluster/memberselector/impl/AndMemberSelector';
import { OrMemberSelector } from '@zenystx/helios-core/cluster/memberselector/impl/OrMemberSelector';

/** Selects only lite members (own no partition). */
export const LITE_MEMBER_SELECTOR: MemberSelector = { select: (m) => m.isLiteMember() };

/** Selects only data members (own a partition). */
export const DATA_MEMBER_SELECTOR: MemberSelector = { select: (m) => !m.isLiteMember() };

/** Selects only the local member. */
export const LOCAL_MEMBER_SELECTOR: MemberSelector = { select: (m) => m.localMember() };

/** Selects only remote (non-local) members. */
export const NON_LOCAL_MEMBER_SELECTOR: MemberSelector = { select: (m) => !m.localMember() };

export class MemberSelectors {
    private constructor() {}

    /** Returns a selector that succeeds when one of the given selectors succeeds (OR). */
    static or(...selectors: MemberSelector[]): MemberSelector {
        return new OrMemberSelector(...selectors);
    }

    /** Returns a selector that succeeds when all of the given selectors succeed (AND). */
    static and(...selectors: MemberSelector[]): MemberSelector {
        return new AndMemberSelector(...selectors);
    }
}
