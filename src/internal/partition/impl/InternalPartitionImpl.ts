/**
 * Port of {@code com.hazelcast.internal.partition.impl.InternalPartitionImpl}.
 * Mutable implementation of InternalPartition.
 */
import { AbstractInternalPartition } from '@zenystx/helios-core/internal/partition/AbstractInternalPartition';
import type { InternalPartition } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import type { PartitionReplicaInterceptor } from '@zenystx/helios-core/internal/partition/PartitionReplicaInterceptor';

export class InternalPartitionImpl extends AbstractInternalPartition {
    private _replicas: (PartitionReplica | null)[];
    private readonly _interceptor: PartitionReplicaInterceptor | null;
    private _version: number;
    private _localReplica: PartitionReplica | null;
    private _isMigrating: boolean;
    private _ownershipEpoch: number;
    /** If non-null, partition is in staged promotion and traffic is fenced until finalize. */
    private _pendingPromotion: { sourceUuid: string; targetUuid: string } | null;

    constructor(
        partitionId: number,
        localReplica: PartitionReplica | null,
        interceptor: PartitionReplicaInterceptor | null,
    );
    constructor(
        partitionId: number,
        localReplica: PartitionReplica | null,
        replicasArg: (PartitionReplica | null)[],
        version: number,
        interceptor: PartitionReplicaInterceptor | null,
    );
    constructor(
        partitionId: number,
        localReplica: PartitionReplica | null,
        interceptorOrReplicas: PartitionReplicaInterceptor | null | (PartitionReplica | null)[],
        version?: number,
        interceptor?: PartitionReplicaInterceptor | null,
    ) {
        super(partitionId);
        this._localReplica = localReplica;
        this._isMigrating = false;
        this._ownershipEpoch = 0;
        this._pendingPromotion = null;
        if (Array.isArray(interceptorOrReplicas)) {
            this._replicas = interceptorOrReplicas as (PartitionReplica | null)[];
            this._version = version ?? 0;
            this._interceptor = interceptor ?? null;
        } else {
            this._replicas = new Array(MAX_REPLICA_COUNT).fill(null);
            this._version = 0;
            this._interceptor = interceptorOrReplicas as PartitionReplicaInterceptor | null;
        }
    }

    protected replicas(): (PartitionReplica | null)[] {
        return this._replicas;
    }

    isMigrating(): boolean {
        return this._isMigrating;
    }

    setMigrating(): boolean {
        if (this._isMigrating) return false;
        this._isMigrating = true;
        return true;
    }

    resetMigrating(): void {
        this._isMigrating = false;
    }

    isLocal(): boolean {
        const local = this._localReplica;
        return local != null && local.equals(this.getOwnerReplicaOrNull());
    }

    version(): number {
        return this._version;
    }

    getReplica(replicaIndex: number): PartitionReplica | null {
        return this._replicas[replicaIndex] ?? null;
    }

    swapReplicas(index1: number, index2: number): void {
        const newReplicas = [...this._replicas];
        const a1 = newReplicas[index1] ?? null;
        const a2 = newReplicas[index2] ?? null;
        newReplicas[index1] = a2;
        newReplicas[index2] = a1;
        this._replicas = newReplicas;
        this._onReplicaChange(index1, a1, a2);
        this._onReplicaChange(index2, a2, a1);
    }

    setReplicasAndVersion(partition: InternalPartition): boolean {
        const ownerChanged = this._setReplicasArr(partition.getReplicasCopy(), false);
        this._version = partition.version();
        return ownerChanged;
    }

    setVersion(version: number): void {
        this._version = version;
    }

    setReplicas(newReplicas: (PartitionReplica | null)[]): void {
        const oldReplicas = this._replicas;
        this._replicas = newReplicas;
        this._onReplicasChange(newReplicas, oldReplicas);
    }

    private _setReplicasArr(newReplicas: (PartitionReplica | null)[], invokeInterceptor: boolean): boolean {
        const oldReplicas = this._replicas;
        this._replicas = newReplicas;
        return this._onReplicasChangeWith(newReplicas, oldReplicas, invokeInterceptor);
    }

    setReplica(replicaIndex: number, newReplica: PartitionReplica | null): void {
        const newReplicas = [...this._replicas];
        const oldReplica = newReplicas[replicaIndex] ?? null;
        newReplicas[replicaIndex] = newReplica;
        this._replicas = newReplicas;
        this._onReplicaChange(replicaIndex, oldReplica, newReplica);
    }

    private _onReplicasChange(newReplicas: (PartitionReplica | null)[], oldReplicas: (PartitionReplica | null)[]): boolean {
        return this._onReplicasChangeWith(newReplicas, oldReplicas, true);
    }

    private _onReplicasChangeWith(
        newReplicas: (PartitionReplica | null)[],
        oldReplicas: (PartitionReplica | null)[],
        invokeInterceptor: boolean,
    ): boolean {
        const oldOwner = oldReplicas[0] ?? null;
        const newOwner = newReplicas[0] ?? null;
        const ownerChanged = this._onReplicaChangeWith(0, oldOwner, newOwner, invokeInterceptor);
        const len = Math.max(oldReplicas.length, newReplicas.length, MAX_REPLICA_COUNT);
        for (let i = 1; i < len; i++) {
            const old = (oldReplicas[i] ?? null);
            const neu = (newReplicas[i] ?? null);
            this._onReplicaChangeWith(i, old, neu, invokeInterceptor);
        }
        return ownerChanged;
    }

    private _onReplicaChange(replicaIndex: number, oldReplica: PartitionReplica | null, newReplica: PartitionReplica | null): boolean {
        return this._onReplicaChangeWith(replicaIndex, oldReplica, newReplica, true);
    }

    private _onReplicaChangeWith(
        replicaIndex: number,
        oldReplica: PartitionReplica | null,
        newReplica: PartitionReplica | null,
        invokeInterceptor: boolean,
    ): boolean {
        let changed: boolean;
        if (oldReplica == null) {
            changed = newReplica != null;
        } else {
            changed = !oldReplica.equals(newReplica);
        }
        if (!changed) return false;
        this._version++;
        if (this._interceptor && invokeInterceptor) {
            this._interceptor.replicaChanged(this.partitionId, replicaIndex, oldReplica, newReplica);
        }
        return true;
    }

    // ── Ownership epoch and staged promotion ────────────────────

    ownershipEpoch(): number {
        return this._ownershipEpoch;
    }

    incrementOwnershipEpoch(): number {
        return ++this._ownershipEpoch;
    }

    /** Returns true if the partition is in a staged-promotion state awaiting finalize. */
    isPendingPromotion(): boolean {
        return this._pendingPromotion !== null;
    }

    getPendingPromotion(): { sourceUuid: string; targetUuid: string } | null {
        return this._pendingPromotion;
    }

    /**
     * Begin a staged promotion. The partition is fenced for owner traffic until
     * {@link finalizePromotion} is called.
     */
    beginPromotion(sourceUuid: string, targetUuid: string): void {
        this._pendingPromotion = { sourceUuid, targetUuid };
        this._isMigrating = true;
    }

    /**
     * Finalize a staged promotion: increment the ownership epoch and clear the
     * pending promotion state, allowing owner traffic to resume.
     */
    finalizePromotion(): number {
        this._pendingPromotion = null;
        this._isMigrating = false;
        return this.incrementOwnershipEpoch();
    }

    /**
     * Returns true if owner traffic should be fenced for this partition.
     * Traffic is fenced when a promotion is pending and not yet finalized.
     */
    isOwnerTrafficFenced(): boolean {
        return this._pendingPromotion !== null;
    }

    copy(interceptor: PartitionReplicaInterceptor | null): InternalPartitionImpl {
        return new InternalPartitionImpl(
            this.partitionId,
            this._localReplica,
            [...this._replicas],
            this._version,
            interceptor,
        );
    }

    replaceReplica(oldReplica: PartitionReplica, newReplica: PartitionReplica | null): number {
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            const current = this._replicas[i] ?? null;
            if (current == null) break;
            if (current.equals(oldReplica)) {
                const newReplicas = [...this._replicas];
                newReplicas[i] = newReplica;
                this._replicas = newReplicas;
                this._onReplicaChange(i, oldReplica, newReplica);
                return i;
            }
        }
        return -1;
    }

    reset(localReplica: PartitionReplica): void {
        this._replicas = new Array(MAX_REPLICA_COUNT).fill(null);
        this._localReplica = localReplica;
        this._version = 0;
        this.resetMigrating();
    }

    static getReplicaIndex(replicas: (PartitionReplica | null)[], replica: PartitionReplica | null): number {
        if (replica == null) return -1;
        for (let i = 0; i < replicas.length; i++) {
            const r = replicas[i] ?? null;
            if (r && replica.equals(r)) return i;
        }
        return -1;
    }
}
