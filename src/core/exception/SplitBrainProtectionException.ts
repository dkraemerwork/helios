/**
 * Thrown when an operation is rejected because the named split-brain protection
 * quorum is not met for the target data structure.
 *
 * Port of {@code com.hazelcast.splitbrainprotection.SplitBrainProtectionException}.
 */
import { HeliosException } from '@zenystx/helios-core/core/exception/HeliosException.js';

export class SplitBrainProtectionException extends HeliosException {
    /** Name of the split-brain protection configuration that was not satisfied. */
    readonly protectionName: string;
    /** Minimum cluster size required by the protection config. */
    readonly minimumSize: number;
    /** Actual number of reachable members at the time of rejection. */
    readonly currentSize: number;

    constructor(
        protectionName: string,
        minimumSize: number,
        currentSize: number,
        message?: string,
    ) {
        super(
            message ??
                `Split-brain protection '${protectionName}' quorum not met: ` +
                `minimum=${minimumSize}, current=${currentSize}`,
        );
        this.name = 'SplitBrainProtectionException';
        this.protectionName = protectionName;
        this.minimumSize = minimumSize;
        this.currentSize = currentSize;
    }
}
