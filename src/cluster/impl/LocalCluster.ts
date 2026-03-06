import type { Cluster } from '@zenystx/core/cluster/Cluster';
import type { Member } from '@zenystx/core/cluster/Member';
import { Address } from '@zenystx/core/cluster/Address';
import { MemberVersion } from '@zenystx/core/version/MemberVersion';
import type { EndpointQualifier } from '@zenystx/core/instance/EndpointQualifier';

/**
 * Minimal single-node Cluster implementation.
 * Represents the local member only (no real cluster topology).
 */
class LocalMember implements Member {
    private readonly _address = new Address('127.0.0.1', 5701);
    private readonly _uuid = crypto.randomUUID();
    private readonly _attributes = new Map<string, string>();

    localMember(): boolean { return true; }
    isLiteMember(): boolean { return false; }
    getAddress(): Address { return this._address; }
    getUuid(): string { return this._uuid; }
    getAddressMap(): Map<EndpointQualifier, Address> { return new Map(); }
    getAttributes(): Map<string, string> { return this._attributes; }
    getAttribute(key: string): string | null { return this._attributes.get(key) ?? null; }
    getVersion(): MemberVersion { return MemberVersion.UNKNOWN; }
}

/**
 * Cluster view for a single local node.
 * Port of com.hazelcast.internal.cluster.impl.ClusterServiceImpl (minimal surface).
 */
export class LocalCluster implements Cluster {
    private readonly _localMember = new LocalMember();

    getMembers(): Member[] {
        return [this._localMember];
    }

    getLocalMember(): Member {
        return this._localMember;
    }
}
