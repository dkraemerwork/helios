/**
 * Port of {@code com.hazelcast.spi.exception.RetryableException} and subtypes.
 *
 * Retryable exceptions signal transient failures that the invocation framework
 * should retry with backoff rather than fail immediately.
 */
import type { Address } from '@helios/cluster/Address';

export class RetryableException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RetryableException';
    }
}

/** The target partition is not owned by this node. */
export class WrongTargetException extends RetryableException {
    constructor(message: string) {
        super(message);
        this.name = 'WrongTargetException';
    }
}

/** The target partition is actively migrating. */
export class PartitionMigratingException extends RetryableException {
    constructor(partitionId: number) {
        super(`Partition ${partitionId} is migrating`);
        this.name = 'PartitionMigratingException';
    }
}

/** The target address is not a current cluster member. */
export class TargetNotMemberException extends RetryableException {
    constructor(address: Address) {
        super(`Target ${address.toString()} is not a cluster member`);
        this.name = 'TargetNotMemberException';
    }
}

/** The target member has left the cluster. */
export class MemberLeftException extends RetryableException {
    constructor(memberUuid: string) {
        super(`Member ${memberUuid} has left the cluster`);
        this.name = 'MemberLeftException';
    }
}
