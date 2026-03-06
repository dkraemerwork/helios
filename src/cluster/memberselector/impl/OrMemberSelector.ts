/**
 * Port of {@code com.hazelcast.cluster.memberselector.impl.OrMemberSelector}.
 * Selects a member if any sub-selector succeeds (short-circuit OR).
 */
import type { Member } from '@zenystx/helios-core/cluster/Member';
import type { MemberSelector } from '@zenystx/helios-core/cluster/MemberSelector';

export class OrMemberSelector implements MemberSelector {
    private readonly selectors: MemberSelector[];

    constructor(...selectors: MemberSelector[]) {
        this.selectors = selectors;
    }

    select(member: Member): boolean {
        for (const selector of this.selectors) {
            if (selector.select(member)) {
                return true;
            }
        }
        return false;
    }
}
