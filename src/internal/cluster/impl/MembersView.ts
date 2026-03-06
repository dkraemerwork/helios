/**
 * Port of {@code com.hazelcast.internal.cluster.impl.MembersView}.
 * Container for a member list + version.
 */
import { MemberImpl } from '@zenystx/core/cluster/impl/MemberImpl';
import { MemberInfo } from '@zenystx/core/cluster/MemberInfo';
import { Address } from '@zenystx/core/cluster/Address';
import { MemberMap } from '@zenystx/core/internal/cluster/impl/MemberMap';

export class MembersView {
    private readonly _version: number;
    private readonly _members: MemberInfo[];

    constructor(version: number, members: MemberInfo[]) {
        this._version = version;
        this._members = members;
    }

    static createNew(version: number, members: Iterable<MemberImpl>): MembersView {
        const list: MemberInfo[] = [];
        for (const m of members) {
            list.push(new MemberInfo(m));
        }
        return new MembersView(version, list);
    }

    static cloneAdding(source: MembersView, newMembers: MemberInfo[]): MembersView {
        const list: MemberInfo[] = [...source._members];
        let newVersion = Math.max(source._version, source._members.length);
        for (const nm of newMembers) {
            newVersion++;
            list.push(new MemberInfo(
                nm.getAddress(),
                nm.getUuid(),
                nm.getAttributes(),
                nm.isLiteMember(),
                nm.getVersion(),
                nm.getAddressMap(),
            ));
        }
        return new MembersView(newVersion, list);
    }

    getMembers(): MemberInfo[] {
        return this._members;
    }

    size(): number {
        return this._members.length;
    }

    getVersion(): number {
        return this._version;
    }

    toMemberMap(): MemberMap {
        const ms: MemberImpl[] = this._members.map(mi => mi.toMember());
        return MemberMap.createNew(this._version, ...ms);
    }

    containsAddress(address: Address): boolean {
        return this._members.some(m => m.getAddress().equals(address));
    }

    containsMember(address: Address, uuid: string): boolean {
        for (const m of this._members) {
            if (m.getAddress().equals(address)) {
                return m.getUuid() === uuid;
            }
        }
        return false;
    }

    getAddresses(): Set<Address> {
        const result = new Set<Address>();
        for (const m of this._members) {
            result.add(m.getAddress());
        }
        return result;
    }

    getMember(address: Address): MemberInfo | null {
        for (const m of this._members) {
            if (m.getAddress().equals(address)) return m;
        }
        return null;
    }

    isLaterThan(other: MembersView): boolean {
        return this._version > other._version;
    }

    toString(): string {
        return `MembersView{version=${this._version}, members=${this._members}}`;
    }
}
