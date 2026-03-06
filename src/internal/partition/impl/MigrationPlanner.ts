/**
 * Port of {@code com.hazelcast.internal.partition.impl.MigrationPlanner}.
 *
 * Decides type and order of migrations to move partition replica state from
 * current to targeted ownership. Planned migrations never decrease the available
 * replica count of a partition.
 */
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { MigrationInfo } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import { AbstractInternalPartition } from '@zenystx/helios-core/internal/partition/AbstractInternalPartition';
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';

export interface MigrationDecisionCallback {
    migrate(
        source: PartitionReplica | null,
        sourceCurrentReplicaIndex: number,
        sourceNewReplicaIndex: number,
        destination: PartitionReplica | null,
        destinationCurrentReplicaIndex: number,
        destinationNewReplicaIndex: number,
    ): void;
}

export class MigrationPlanner {
    private readonly _state: (PartitionReplica | null)[] = new Array(MAX_REPLICA_COUNT).fill(null);

    // eslint-disable-next-line max-lines-per-function, complexity
    planMigrations(
        _partitionId: number,
        oldReplicas: (PartitionReplica | null)[],
        newReplicas: (PartitionReplica | null)[],
        callback: MigrationDecisionCallback,
    ): void {
        this._initState(oldReplicas);
        this._fixCyclePublic(oldReplicas, newReplicas);

        let currentIndex = 0;
        while (currentIndex < oldReplicas.length) {
            if (newReplicas[currentIndex] == null) {
                if (this._state[currentIndex] != null) {
                    callback.migrate(this._state[currentIndex], currentIndex, -1, null, -1, -1);
                    this._state[currentIndex] = null;
                }
                currentIndex++;
                continue;
            }

            if (this._state[currentIndex] == null) {
                const i = getReplicaIndex(this._state, newReplicas[currentIndex]);
                if (i === -1) {
                    // COPY
                    callback.migrate(null, -1, -1, newReplicas[currentIndex], -1, currentIndex);
                    this._state[currentIndex] = newReplicas[currentIndex];
                    currentIndex++;
                    continue;
                }

                if (i > currentIndex) {
                    // SHIFT UP
                    callback.migrate(null, -1, -1, this._state[i], i, currentIndex);
                    this._state[currentIndex] = this._state[i];
                    this._state[i] = null;
                    continue;
                }

                throw new Error(
                    `Migration decision algorithm failed during SHIFT UP! state=${JSON.stringify(this._state)} old=${JSON.stringify(oldReplicas)} new=${JSON.stringify(newReplicas)}`
                );
            }

            if (newReplicas[currentIndex]!.equals(this._state[currentIndex])) {
                currentIndex++;
                continue;
            }

            if (
                getReplicaIndex(newReplicas, this._state[currentIndex]) === -1 &&
                getReplicaIndex(this._state, newReplicas[currentIndex]) === -1
            ) {
                // MOVE
                callback.migrate(this._state[currentIndex], currentIndex, -1, newReplicas[currentIndex], -1, currentIndex);
                this._state[currentIndex] = newReplicas[currentIndex];
                currentIndex++;
                continue;
            }

            if (getReplicaIndex(this._state, newReplicas[currentIndex]) === -1) {
                const newIndex = getReplicaIndex(newReplicas, this._state[currentIndex]);
                if (this._state[newIndex] == null) {
                    // SHIFT DOWN
                    callback.migrate(this._state[currentIndex], currentIndex, newIndex, newReplicas[currentIndex], -1, currentIndex);
                    this._state[newIndex] = this._state[currentIndex];
                } else {
                    // MOVE-3
                    callback.migrate(this._state[currentIndex], currentIndex, -1, newReplicas[currentIndex], -1, currentIndex);
                }
                this._state[currentIndex] = newReplicas[currentIndex];
                currentIndex++;
                continue;
            }

            this._planMigrationsInner(_partitionId, oldReplicas, newReplicas, callback, currentIndex);
            // No increment — outer loop re-processes same currentIndex (state has changed)
        }
    }

    // eslint-disable-next-line max-lines-per-function, complexity
    private _planMigrationsInner(
        _partitionId: number,
        _oldReplicas: (PartitionReplica | null)[],
        newReplicas: (PartitionReplica | null)[],
        callback: MigrationDecisionCallback,
        startIndex: number,
    ): void {
        let currentIndex = startIndex;
        while (true) {
            const targetIndex = getReplicaIndex(this._state, newReplicas[currentIndex]);

            if (newReplicas[targetIndex] == null) {
                if (this._state[currentIndex] == null) {
                    callback.migrate(this._state[currentIndex], currentIndex, -1, this._state[targetIndex], targetIndex, currentIndex);
                    this._state[currentIndex] = this._state[targetIndex];
                } else {
                    const newIndex = getReplicaIndex(newReplicas, this._state[currentIndex]);
                    if (newIndex === -1) {
                        callback.migrate(this._state[currentIndex], currentIndex, -1, this._state[targetIndex], targetIndex, currentIndex);
                        this._state[currentIndex] = this._state[targetIndex];
                    } else if (this._state[newIndex] == null) {
                        // SHIFT UP + SHIFT DOWN
                        callback.migrate(this._state[currentIndex], currentIndex, newIndex, this._state[targetIndex], targetIndex, currentIndex);
                        this._state[newIndex] = this._state[currentIndex];
                        this._state[currentIndex] = this._state[targetIndex];
                    } else {
                        // only SHIFT UP
                        callback.migrate(this._state[currentIndex], currentIndex, -1, this._state[targetIndex], targetIndex, currentIndex);
                        this._state[currentIndex] = this._state[targetIndex];
                    }
                }
                this._state[targetIndex] = null;
                break;
            } else if (getReplicaIndex(this._state, newReplicas[targetIndex]) === -1) {
                // MOVE-2
                callback.migrate(this._state[targetIndex], targetIndex, -1, newReplicas[targetIndex], -1, targetIndex);
                this._state[targetIndex] = newReplicas[targetIndex];
                break;
            } else {
                currentIndex = targetIndex;
            }
        }
    }

    /**
     * Prioritizes COPY/SHIFT UP migrations against non-conflicting MOVE migrations
     * on hotter indices or SHIFT DOWN migrations to colder indices.
     */
    prioritizeCopiesAndShiftUps(migrations: MigrationInfo[]): void {
        for (let i = 0; i < migrations.length; i++) {
            this._prioritize(migrations, i);
        }
    }

    private _prioritize(migrations: MigrationInfo[], i: number): void {
        const migration = migrations[i]!;
        if (migration.getSourceCurrentReplicaIndex() !== -1) return; // not a COPY/SHIFT UP

        let k = i - 1;
        for (; k >= 0; k--) {
            const other = migrations[k]!;
            if (other.getSourceCurrentReplicaIndex() === -1) break; // stop at another copy

            const dest = migration.getDestination();
            if (dest && (dest.equals(other.getSource()) || dest.equals(other.getDestination()))) break; // conflict

            if (
                other.getSourceNewReplicaIndex() !== -1 &&
                other.getSourceNewReplicaIndex() < migration.getDestinationNewReplicaIndex()
            ) {
                break; // hotter shift down
            }
        }

        if ((k + 1) !== i) {
            migrations.splice(i, 1);
            migrations.splice(k + 1, 0, migration);
        }
    }

    private _initState(oldReplicas: (PartitionReplica | null)[]): void {
        this._state.fill(null);
        for (let i = 0; i < oldReplicas.length && i < MAX_REPLICA_COUNT; i++) {
            this._state[i] = oldReplicas[i] ?? null;
        }
    }

    isCyclic(oldReplicas: (PartitionReplica | null)[], newReplicas: (PartitionReplica | null)[]): boolean {
        for (let i = 0; i < oldReplicas.length; i++) {
            const oldAddr = oldReplicas[i] ?? null;
            const newAddr = newReplicas[i] ?? null;
            if (oldAddr == null || newAddr == null || oldAddr.equals(newAddr)) continue;
            if (this._isCyclicAt(oldReplicas, newReplicas, i)) return true;
        }
        return false;
    }

    private _fixCyclePublic(oldReplicas: (PartitionReplica | null)[], newReplicas: (PartitionReplica | null)[]): boolean {
        let cyclic = false;
        for (let i = 0; i < oldReplicas.length; i++) {
            const oldAddr = oldReplicas[i] ?? null;
            const newAddr = newReplicas[i] ?? null;
            if (oldAddr == null || newAddr == null || oldAddr.equals(newAddr)) continue;
            if (this._isCyclicAt(oldReplicas, newReplicas, i)) {
                this._fixCycleAt(oldReplicas, newReplicas, i);
                cyclic = true;
            }
        }
        return cyclic;
    }

    private _isCyclicAt(
        oldReplicas: (PartitionReplica | null)[],
        newReplicas: (PartitionReplica | null)[],
        index: number,
    ): boolean {
        const newOwner = newReplicas[index] ?? null;
        let firstIndex = index;
        while (true) {
            const nextIndex = AbstractInternalPartition.getReplicaIndex(newReplicas, oldReplicas[firstIndex] ?? null);
            if (nextIndex === -1) return false;
            if (firstIndex === nextIndex) return false;
            if (newOwner && newOwner.equals(oldReplicas[nextIndex] ?? null)) return true;
            firstIndex = nextIndex;
        }
    }

    private _fixCycleAt(
        oldReplicas: (PartitionReplica | null)[],
        newReplicas: (PartitionReplica | null)[],
        index: number,
    ): void {
        let i = index;
        while (true) {
            const nextIndex = AbstractInternalPartition.getReplicaIndex(newReplicas, oldReplicas[i] ?? null);
            newReplicas[i] = oldReplicas[i];
            if (nextIndex === -1) return;
            i = nextIndex;
        }
    }
}

function getReplicaIndex(replicas: (PartitionReplica | null)[], replica: PartitionReplica | null): number {
    return AbstractInternalPartition.getReplicaIndex(replicas, replica);
}
