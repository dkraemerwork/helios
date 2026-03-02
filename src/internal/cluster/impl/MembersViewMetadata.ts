/**
 * Port of {@code com.hazelcast.internal.cluster.impl.MembersViewMetadata}.
 */
import type { Address } from '@helios/cluster/Address';

export class MembersViewMetadata {
    readonly #memberAddress: Address;
    readonly #memberUuid: string;
    readonly #masterAddress: Address | null;
    readonly #memberListVersion: number;

    constructor(
        memberAddress: Address,
        memberUuid: string,
        masterAddress: Address | null,
        memberListVersion: number,
    ) {
        this.#memberAddress = memberAddress;
        this.#memberUuid = memberUuid;
        this.#masterAddress = masterAddress;
        this.#memberListVersion = memberListVersion;
    }

    getMemberAddress(): Address { return this.#memberAddress; }
    getMemberUuid(): string { return this.#memberUuid; }
    getMasterAddress(): Address | null { return this.#masterAddress; }
    getMemberListVersion(): number { return this.#memberListVersion; }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof MembersViewMetadata)) return false;
        if (this.#memberListVersion !== other.#memberListVersion) return false;
        if (!this.#memberAddress.equals(other.#memberAddress)) return false;
        if (this.#memberUuid !== other.#memberUuid) return false;
        // masterAddress: both null, or both non-null and equal
        if (this.#masterAddress === null && other.#masterAddress === null) return true;
        if (this.#masterAddress === null || other.#masterAddress === null) return false;
        return this.#masterAddress.equals(other.#masterAddress);
    }

    hashCode(): number {
        let result = this.#memberAddress.hashCode();
        let h = 0;
        for (const ch of this.#memberUuid) {
            h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
        }
        result = (Math.imul(31, result) + h) | 0;
        result = (Math.imul(31, result) + (this.#masterAddress !== null ? this.#masterAddress.hashCode() : 0)) | 0;
        result = (Math.imul(31, result) + this.#memberListVersion) | 0;
        return result;
    }

    toString(): string {
        return `MembersViewMetadata{address=${this.#memberAddress}, memberUuid='${this.#memberUuid}', masterAddress=${this.#masterAddress}, memberListVersion=${this.#memberListVersion}}`;
    }
}
