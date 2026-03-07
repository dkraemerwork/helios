/**
 * Client-side partition service.
 *
 * Port of {@code com.hazelcast.client.impl.spi.impl.ClientPartitionServiceImpl}.
 * Tracks versioned partition ownership table.
 */
export class ClientPartitionService {
    private _partitionCount = 0;
    private _partitionStateVersion = -1;
    private readonly _partitions = new Map<number, string>();

    getPartitionCount(): number {
        return this._partitionCount;
    }

    getPartitionOwner(partitionId: number): string | null {
        return this._partitions.get(partitionId) ?? null;
    }

    getPartitionId(keyHash: number): number {
        if (this._partitionCount === 0) {
            throw new Error("Partition count is not set — client may not be connected");
        }
        return Math.abs(keyHash) % this._partitionCount;
    }

    handlePartitionsViewEvent(
        partitions: Map<string, number[]>,
        partitionStateVersion: number,
        partitionCount: number,
    ): void {
        // Version monotonicity
        if (partitionStateVersion <= this._partitionStateVersion) {
            return;
        }

        if (partitionCount > 0 && this._partitionCount === 0) {
            this._partitionCount = partitionCount;
        }

        this._partitionStateVersion = partitionStateVersion;
        this._partitions.clear();

        for (const [uuid, ids] of partitions) {
            for (const id of ids) {
                this._partitions.set(id, uuid);
            }
        }
    }

    getPartitionStateVersion(): number {
        return this._partitionStateVersion;
    }

    reset(): void {
        this._partitions.clear();
        this._partitionStateVersion = -1;
    }
}
