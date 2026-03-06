/**
 * Port of {@code com.hazelcast.internal.partition.PartitionReplica}.
 * Represents the owner of a partition replica in the partition table.
 */
import { Address } from '@zenystx/helios-core/cluster/Address';

export class PartitionReplica {
    private readonly _address: Address;
    private readonly _uuid: string;

    constructor(address: Address, uuid: string) {
        this._address = address;
        this._uuid = uuid;
    }

    address(): Address {
        return this._address;
    }

    uuid(): string {
        return this._uuid;
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof PartitionReplica)) return false;
        return this._address.equals(other._address) && this._uuid === other._uuid;
    }

    hashCode(): number {
        let result = this._address.hashCode();
        let h = 0;
        for (const ch of this._uuid) {
            h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
        }
        result = (Math.imul(31, result) + h) | 0;
        return result;
    }

    toString(): string {
        return `[${this._address.host}]:${this._address.port} - ${this._uuid}`;
    }
}
