/**
 * Port of {@code com.hazelcast.internal.cluster.Versions}.
 * Cluster version constants.
 */
import { Version } from '@helios/version/Version';

export class Versions {
    static readonly V4_0: Version = Version.of(4, 0);
    static readonly V4_1: Version = Version.of(4, 1);
    static readonly V4_2: Version = Version.of(4, 2);
    static readonly V5_0: Version = Version.of(5, 0);
    static readonly V5_1: Version = Version.of(5, 1);
    static readonly V5_2: Version = Version.of(5, 2);
    static readonly V5_3: Version = Version.of(5, 3);
    static readonly V5_4: Version = Version.of(5, 4);
    static readonly V5_5: Version = Version.of(5, 5);
    static readonly V5_6: Version = Version.of(5, 6);
    static readonly V5_7: Version = Version.of(5, 7);

    /** Current cluster version (5.7). */
    static readonly CURRENT_CLUSTER_VERSION: Version = Version.of(5, 7);

    private constructor() {}

    static isLts(version: Version): boolean {
        return version.isEqualTo(Versions.V5_5);
    }
}
