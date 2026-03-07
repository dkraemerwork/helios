/**
 * Port of {@code com.hazelcast.internal.cluster.MemberInfo}.
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';
import { MemberImpl } from '@zenystx/helios-core/cluster/impl/MemberImpl';
import type { EndpointQualifier } from '@zenystx/helios-core/instance/EndpointQualifier';
import type { MemberVersion } from '@zenystx/helios-core/version/MemberVersion';

export class MemberInfo {
    readonly #address: Address;
    readonly #uuid: string;
    readonly #cpMemberUUID: string | null;
    readonly #attributes: Map<string, string>;
    readonly #liteMember: boolean;
    readonly #version: MemberVersion;
    readonly #memberListJoinVersion: number;
    readonly #addressMap: Map<EndpointQualifier, Address>;

    /** Construct from a MemberImpl instance. */
    constructor(member: MemberImpl);
    /** Construct with explicit fields. */
    constructor(
        address: Address,
        uuid: string,
        attributes: Map<string, string> | null,
        liteMember: boolean,
        version: MemberVersion,
        addressMap?: Map<EndpointQualifier, Address>,
    );
    constructor(
        addressOrMember: Address | MemberImpl,
        uuid?: string,
        attributesOrUnused?: Map<string, string> | null,
        liteMemberOrUnused?: boolean,
        versionOrUnused?: MemberVersion,
        addressMapOrUnused?: Map<EndpointQualifier, Address>,
    ) {
        if (addressOrMember instanceof MemberImpl) {
            const m = addressOrMember;
            this.#address = m.getAddress();
            this.#uuid = m.getUuid();
            this.#cpMemberUUID = null;
            this.#attributes = m.getAttributes();
            this.#liteMember = m.isLiteMember();
            this.#version = m.getVersion();
            this.#memberListJoinVersion = m.getMemberListJoinVersion();
            this.#addressMap = m.getAddressMap();
            return;
        }
        this.#address = addressOrMember;
        this.#uuid = uuid!;
        this.#cpMemberUUID = null;
        this.#attributes = attributesOrUnused ?? new Map();
        this.#liteMember = liteMemberOrUnused ?? false;
        this.#version = versionOrUnused!;
        this.#memberListJoinVersion = MemberImpl.NA_MEMBER_LIST_JOIN_VERSION;
        this.#addressMap = addressMapOrUnused ?? new Map();
    }

    getAddress(): Address { return this.#address; }
    getUuid(): string { return this.#uuid; }
    getCPMemberUUID(): string | null { return this.#cpMemberUUID; }
    getAttributes(): Map<string, string> { return this.#attributes; }
    isLiteMember(): boolean { return this.#liteMember; }
    getVersion(): MemberVersion { return this.#version; }
    getMemberListJoinVersion(): number { return this.#memberListJoinVersion; }
    getAddressMap(): Map<EndpointQualifier, Address> { return this.#addressMap; }

    // legacy property accessors for code that accesses fields directly
    get address(): Address { return this.#address; }
    get uuid(): string { return this.#uuid; }
    get attributes(): Map<string, string> { return this.#attributes; }
    get liteMember(): boolean { return this.#liteMember; }
    get version(): MemberVersion { return this.#version; }
    get addressMap(): Map<EndpointQualifier, Address> { return this.#addressMap; }

    toMember(): MemberImpl {
        return new MemberImpl.Builder(this.#address)
            .version(this.#version)
            .uuid(this.#uuid)
            .attributes(this.#attributes)
            .liteMember(this.#liteMember)
            .memberListJoinVersion(this.#memberListJoinVersion)
            .build();
    }

    equals(other: unknown): boolean {
        if (!(other instanceof MemberInfo)) return false;
        return (
            this.#address.equals(other.#address) &&
            this.#uuid === other.#uuid &&
            this.#liteMember === other.#liteMember
        );
    }

    toString(): string {
        return `MemberInfo{address=${this.#address}, uuid=${this.#uuid}, liteMember=${this.#liteMember}}`;
    }
}
