/**
 * Client-side cluster membership service.
 *
 * Port of {@code com.hazelcast.client.impl.spi.impl.ClientClusterServiceImpl}.
 * Tracks versioned member list and fires membership events.
 */
import type { MemberInfo } from "@zenystx/helios-core/cluster/MemberInfo";

export interface MembershipListener {
    memberAdded?(event: MembershipEvent): void;
    memberRemoved?(event: MembershipEvent): void;
}

export interface MembershipEvent {
    member: MemberInfo;
    members: MemberInfo[];
}

let _listenerIdCounter = 0;

export class ClientClusterService {
    private _memberListVersion = -1;
    private _clusterUuid: string | null = null;
    private _members: MemberInfo[] = [];
    private readonly _listeners = new Map<string, MembershipListener>();

    getMemberList(): MemberInfo[] {
        return [...this._members];
    }

    getMemberListVersion(): number {
        return this._memberListVersion;
    }

    getClusterUuid(): string | null {
        return this._clusterUuid;
    }

    getMember(uuid: string): MemberInfo | null {
        return this._members.find((m) => m.getUuid() === uuid) ?? null;
    }

    handleMembersViewEvent(
        memberListVersion: number,
        memberInfos: MemberInfo[],
        clusterUuid: string,
    ): void {
        // Version monotonicity: reject stale events
        if (memberListVersion <= this._memberListVersion && clusterUuid === this._clusterUuid) {
            return;
        }

        const previousMembers = this._members;
        const previousUuids = new Set(previousMembers.map((m) => m.getUuid()));
        const currentUuids = new Set(memberInfos.map((m) => m.getUuid()));

        this._members = [...memberInfos];
        this._memberListVersion = memberListVersion;
        this._clusterUuid = clusterUuid;

        // Fire events
        const clusterChanged = this._clusterUuid !== clusterUuid;

        // Members removed
        for (const prev of previousMembers) {
            if (!currentUuids.has(prev.getUuid()) || clusterChanged) {
                this._fireRemoved(prev);
            }
        }

        // Members added
        for (const cur of memberInfos) {
            if (!previousUuids.has(cur.getUuid()) || clusterChanged) {
                this._fireAdded(cur);
            }
        }
    }

    onClusterConnect(newClusterId: string): void {
        this._clusterUuid = newClusterId;
        this._memberListVersion = 0;
        this._members = [];
    }

    addMembershipListener(listener: MembershipListener): string {
        const id = `membership-${++_listenerIdCounter}-${Date.now()}`;
        this._listeners.set(id, listener);
        return id;
    }

    removeMembershipListener(id: string): boolean {
        return this._listeners.delete(id);
    }

    private _fireAdded(member: MemberInfo): void {
        const event: MembershipEvent = { member, members: this._members };
        for (const listener of this._listeners.values()) {
            try {
                listener.memberAdded?.(event);
            } catch {
                // ignore
            }
        }
    }

    private _fireRemoved(member: MemberInfo): void {
        const event: MembershipEvent = { member, members: this._members };
        for (const listener of this._listeners.values()) {
            try {
                listener.memberRemoved?.(event);
            } catch {
                // ignore
            }
        }
    }
}
