/**
 * Port of {@code com.hazelcast.internal.cluster.impl.MemberMap}.
 * Immutable member map allowing lookup by Address or UUID.
 */
import { MemberImpl } from '@zenystx/helios-core/cluster/impl/MemberImpl';
import { Address } from '@zenystx/helios-core/cluster/Address';
import type { Member } from '@zenystx/helios-core/cluster/Member';

class UnmodifiableSet<T> implements Iterable<T> {
    private readonly items: T[];

    constructor(items: T[]) {
        this.items = [...items];
    }

    get size(): number { return this.items.length; }

    [Symbol.iterator](): Iterator<T> {
        return this.items[Symbol.iterator]();
    }

    has(item: T): boolean {
        return this.items.includes(item);
    }

    add(_item: T): never {
        throw new Error('UnsupportedOperationException');
    }

    delete(_item: T): never {
        throw new Error('UnsupportedOperationException');
    }

    clear(): never {
        throw new Error('UnsupportedOperationException');
    }

    toArray(): T[] {
        return [...this.items];
    }
}

export class MemberMap {
    static readonly SINGLETON_MEMBER_LIST_VERSION = 1;

    private readonly _version: number;
    /** address.toString() → MemberImpl */
    private readonly _byAddress: Map<string, MemberImpl>;
    /** uuid string → MemberImpl */
    private readonly _byUuid: Map<string, MemberImpl>;
    /** insertion-ordered members */
    private readonly _members: MemberImpl[];

    constructor(version: number, byAddress: Map<string, MemberImpl>, byUuid: Map<string, MemberImpl>) {
        this._version = version;
        this._byAddress = byAddress;
        this._byUuid = byUuid;
        this._members = [...byAddress.values()];
    }

    static empty(): MemberMap {
        return new MemberMap(0, new Map(), new Map());
    }

    static singleton(member: MemberImpl): MemberMap {
        const byAddr = new Map([[member.getAddress().toString(), member]]);
        const byUuid = new Map([[member.getUuid(), member]]);
        return new MemberMap(MemberMap.SINGLETON_MEMBER_LIST_VERSION, byAddr, byUuid);
    }

    static createNew(...members: MemberImpl[]): MemberMap;
    static createNew(version: number, ...members: MemberImpl[]): MemberMap;
    static createNew(versionOrMember: number | MemberImpl, ...rest: MemberImpl[]): MemberMap {
        let version = 0;
        let members: MemberImpl[];
        if (typeof versionOrMember === 'number') {
            version = versionOrMember;
            members = rest;
        } else {
            members = [versionOrMember, ...rest];
        }

        const byAddr = new Map<string, MemberImpl>();
        const byUuid = new Map<string, MemberImpl>();
        for (const m of members) {
            MemberMap._putMember(byAddr, byUuid, m);
        }
        return new MemberMap(version, byAddr, byUuid);
    }

    static cloneExcluding(source: MemberMap, ...excludeMembers: MemberImpl[]): MemberMap {
        if (source.size() === 0) return source;

        const byAddr = new Map(source._byAddress);
        const byUuid = new Map(source._byUuid);

        for (const member of excludeMembers) {
            const addrKey = member.getAddress().toString();
            const removed = byAddr.get(addrKey);
            if (removed !== undefined) {
                byAddr.delete(addrKey);
                byUuid.delete(removed.getUuid());
            }

            const removedByUuid = byUuid.get(member.getUuid());
            if (removedByUuid !== undefined) {
                byUuid.delete(member.getUuid());
                byAddr.delete(removedByUuid.getAddress().toString());
            }
        }

        return new MemberMap(source._version + excludeMembers.length, byAddr, byUuid);
    }

    static cloneAdding(source: MemberMap, ...newMembers: MemberImpl[]): MemberMap {
        const byAddr = new Map(source._byAddress);
        const byUuid = new Map(source._byUuid);

        for (const m of newMembers) {
            MemberMap._putMember(byAddr, byUuid, m);
        }

        return new MemberMap(source._version + newMembers.length, byAddr, byUuid);
    }

    private static _putMember(
        byAddr: Map<string, MemberImpl>,
        byUuid: Map<string, MemberImpl>,
        member: MemberImpl,
    ): void {
        const addrKey = member.getAddress().toString();
        if (byAddr.has(addrKey)) {
            throw new Error(`Replacing existing member with address: ${member}`);
        }
        if (byUuid.has(member.getUuid())) {
            throw new Error(`Replacing existing member with UUID: ${member}`);
        }
        byAddr.set(addrKey, member);
        byUuid.set(member.getUuid(), member);
    }

    getMemberByAddress(address: Address): MemberImpl | null {
        return this._byAddress.get(address.toString()) ?? null;
    }

    getMemberByUuid(uuid: string): MemberImpl | null {
        return this._byUuid.get(uuid) ?? null;
    }

    getMember(address: Address, uuid: string): MemberImpl | null {
        const m1 = this._byAddress.get(address.toString());
        const m2 = this._byUuid.get(uuid);
        if (m1 !== undefined && m2 !== undefined && m1.equals(m2)) {
            return m1;
        }
        return null;
    }

    contains(address: Address): boolean {
        return this._byAddress.has(address.toString());
    }

    containsUuid(uuid: string): boolean {
        return this._byUuid.has(uuid);
    }

    getMembers(): UnmodifiableSet<MemberImpl> {
        return new UnmodifiableSet(this._members);
    }

    getAddresses(): UnmodifiableSet<Address> {
        return new UnmodifiableSet(this._members.map(m => m.getAddress()));
    }

    size(): number {
        return this._members.length;
    }

    getVersion(): number {
        return this._version;
    }

    tailMemberSet(member: MemberImpl, inclusive: boolean): MemberImpl[] {
        this._ensureMemberExists(member);

        const result: MemberImpl[] = [];
        let found = false;
        for (const m of this._members) {
            if (!found && m.equals(member)) {
                found = true;
                if (inclusive) result.push(m);
                continue;
            }
            if (found) result.push(m);
        }
        return result;
    }

    headMemberSet(member: Member, inclusive: boolean): MemberImpl[] {
        this._ensureMemberExists(member);

        const result: MemberImpl[] = [];
        for (const m of this._members) {
            if (!m.equals(member)) {
                result.push(m);
                continue;
            }
            if (inclusive) result.push(m);
            break;
        }
        return result;
    }

    isBeforeThan(address1: Address, address2: Address): boolean {
        if (address1.equals(address2)) return false;
        if (!this._byAddress.has(address1.toString())) return false;
        if (!this._byAddress.has(address2.toString())) return false;

        for (const m of this._members) {
            if (m.getAddress().equals(address1)) return true;
            if (m.getAddress().equals(address2)) return false;
        }
        throw new Error('Unreachable');
    }

    private _ensureMemberExists(member: Member): void {
        if (!this._byAddress.has(member.getAddress().toString())) {
            throw new Error(`${member} not found!`);
        }
        if (!this._byUuid.has(member.getUuid())) {
            throw new Error(`${member} not found!`);
        }
    }

    toMembersView(): import('@zenystx/helios-core/internal/cluster/impl/MembersView').MembersView {
        // lazy import to avoid circular
        const { MembersView } = require('@zenystx/helios-core/internal/cluster/impl/MembersView');
        return MembersView.createNew(this._version, this._members);
    }
}
