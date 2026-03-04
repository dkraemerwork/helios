/**
 * Port of {@code com.hazelcast.internal.cluster.impl.ConfigCheck}.
 *
 * Validates that a joining node's configuration is compatible with the cluster.
 * Checks cluster name and partition count.
 */

export interface ConfigCheckResult {
    readonly ok: boolean;
    readonly reason?: string;
}

export class ConfigCheck {
    /**
     * Validate that a joiner's config matches the cluster's config.
     *
     * @param localClusterName - The cluster's cluster name
     * @param localPartitionCount - The cluster's partition count
     * @param joinerClusterName - The joining node's cluster name
     * @param joinerPartitionCount - The joining node's partition count
     */
    static check(
        localClusterName: string,
        localPartitionCount: number,
        joinerClusterName: string,
        joinerPartitionCount: number,
    ): ConfigCheckResult {
        if (localClusterName !== joinerClusterName) {
            return {
                ok: false,
                reason: `Incompatible cluster name: expected '${localClusterName}' but joiner has '${joinerClusterName}'`,
            };
        }
        if (localPartitionCount !== joinerPartitionCount) {
            return {
                ok: false,
                reason: `Incompatible partition count: expected ${localPartitionCount} but joiner has ${joinerPartitionCount}`,
            };
        }
        return { ok: true };
    }
}
