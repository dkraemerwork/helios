/**
 * Port of {@code com.hazelcast.internal.partition.PartitionStampUtil}.
 * Calculates a 64-bit stamp for the partition table using MurmurHash3.
 */
import type { InternalPartition } from '@helios/internal/partition/InternalPartition';
import { HashUtil } from '@helios/internal/util/HashUtil';
import { Bits } from '@helios/internal/nio/Bits';

export class PartitionStampUtil {
    private constructor() {}

    static calculateStamp(partitions: (InternalPartition | null)[]): bigint {
        const buf = Buffer.allocUnsafe(4 * partitions.length);
        for (const partition of partitions) {
            if (partition) {
                Bits.writeIntB(buf, partition.getPartitionId() * 4, partition.version());
            }
        }
        return HashUtil.MurmurHash3_x64_64(buf, 0, buf.length);
    }
}
