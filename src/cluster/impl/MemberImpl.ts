/**
 * Port of {@code com.hazelcast.cluster.impl.MemberImpl}.
 * Concrete cluster member implementation with Builder pattern.
 */
import { Address } from '@zenystx/core/cluster/Address';
import type { Member } from '@zenystx/core/cluster/Member';
import type { MemberVersion } from '@zenystx/core/version/MemberVersion';
import type { EndpointQualifier } from '@zenystx/core/instance/EndpointQualifier';

export class MemberImpl implements Member {
    static readonly NA_MEMBER_LIST_JOIN_VERSION = -1;

    readonly #address: Address;
    readonly #uuid: string;
    readonly #version: MemberVersion;
    readonly #liteMember: boolean;
    readonly #localMember: boolean;
    readonly #attributes: Map<string, string>;
    readonly #addressMap: Map<EndpointQualifier, Address>;
    #memberListJoinVersion: number;

    /** @internal Use MemberImpl.Builder to construct instances. */
    constructor(
        address: Address,
        uuid: string,
        version: MemberVersion,
        liteMember: boolean,
        localMember: boolean,
        attributes: Map<string, string> | null,
        memberListJoinVersion: number,
        addressMap: Map<EndpointQualifier, Address>,
    ) {
        this.#address = address;
        this.#uuid = uuid;
        this.#version = version;
        this.#liteMember = liteMember;
        this.#localMember = localMember;
        this.#attributes = attributes ? new Map(attributes) : new Map();
        this.#memberListJoinVersion = memberListJoinVersion;
        this.#addressMap = addressMap;
    }

    localMember(): boolean {
        return this.#localMember;
    }

    isLiteMember(): boolean {
        return this.#liteMember;
    }

    getAddress(): Address {
        return this.#address;
    }

    getUuid(): string {
        return this.#uuid;
    }

    getVersion(): MemberVersion {
        return this.#version;
    }

    getAttributes(): Map<string, string> {
        return new Map(this.#attributes);
    }

    getAttribute(key: string): string | null {
        return this.#attributes.get(key) ?? null;
    }

    getAddressMap(): Map<EndpointQualifier, Address> {
        return this.#addressMap;
    }

    getMemberListJoinVersion(): number {
        return this.#memberListJoinVersion;
    }

    setMemberListJoinVersion(v: number): void {
        this.#memberListJoinVersion = v;
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof MemberImpl)) return false;
        return this.#address.equals(other.#address) && this.#uuid === other.#uuid;
    }

    hashCode(): number {
        const ah = this.#address.hashCode();
        let h = 0;
        for (const ch of this.#uuid) {
            h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
        }
        return (Math.imul(31, ah) + h) | 0;
    }

    toString(): string {
        let s = `Member [${this.#address.getHost()}]:${this.#address.getPort()} - ${this.#uuid}`;
        if (this.#localMember) s += ' this';
        if (this.#liteMember) s += ' lite';
        return s;
    }

    static get Builder() {
        return MemberImplBuilder;
    }
}

export class MemberImplBuilder {
    private _address: Address;
    private _uuid: string = crypto.randomUUID();
    private _version: MemberVersion | null = null;
    private _liteMember = false;
    private _localMember = false;
    private _attributes: Map<string, string> | null = null;
    private _memberListJoinVersion = MemberImpl.NA_MEMBER_LIST_JOIN_VERSION;
    private _addressMap: Map<EndpointQualifier, Address> = new Map();

    constructor(address: Address) {
        if (address == null) throw new Error('address must not be null');
        this._address = address;
    }

    address(addr: Address): this {
        this._address = addr;
        return this;
    }

    uuid(uuid: string): this {
        this._uuid = uuid;
        return this;
    }

    version(v: MemberVersion): this {
        this._version = v;
        return this;
    }

    liteMember(lite: boolean): this {
        this._liteMember = lite;
        return this;
    }

    localMember(local: boolean): this {
        this._localMember = local;
        return this;
    }

    attributes(attrs: Map<string, string>): this {
        this._attributes = attrs;
        return this;
    }

    memberListJoinVersion(v: number): this {
        this._memberListJoinVersion = v;
        return this;
    }

    build(): MemberImpl {
        if (this._version == null) {
            throw new Error('version must be set');
        }
        return new MemberImpl(
            this._address,
            this._uuid,
            this._version,
            this._liteMember,
            this._localMember,
            this._attributes,
            this._memberListJoinVersion,
            this._addressMap,
        );
    }
}
