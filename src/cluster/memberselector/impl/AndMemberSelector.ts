/**
 * Port of {@code com.hazelcast.cluster.memberselector.impl.AndMemberSelector}.
 * Selects a member only if all sub-selectors succeed (short-circuit AND).
 */
import type { Member } from '@zenystx/helios-core/cluster/Member';
import type { MemberSelector } from '@zenystx/helios-core/cluster/MemberSelector';

export class AndMemberSelector implements MemberSelector {
    private readonly selectors: MemberSelector[];

    constructor(...selectors: MemberSelector[]) {
        this.selectors = selectors;
    }

    select(member: Member): boolean {
        for (const selector of this.selectors) {
            if (!selector.select(member)) {
                return false;
            }
        }
        return true;
    }
}
