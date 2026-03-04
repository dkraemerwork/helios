/**
 * Split-brain detection safety mechanism.
 *
 * Tracks member reachability and enters read-only mode when the number of
 * reachable members drops below quorum (⌊N/2⌋ + 1). This prevents silent
 * data divergence during network partitions.
 *
 * NOTE: This is NOT split-brain merge (deferred to v2). This is a lightweight
 * safety gate that prevents writes when quorum is lost.
 */
export class SplitBrainDetector {
    private _totalMembers: number;
    private _quorumSize: number;
    private readonly _reachableMembers: Set<string> = new Set();
    private _readOnlyMode = false;

    constructor(totalMembers: number) {
        this._totalMembers = totalMembers;
        this._quorumSize = Math.floor(totalMembers / 2) + 1;
    }

    updateTotalMembers(total: number): void {
        this._totalMembers = total;
        this._quorumSize = Math.floor(total / 2) + 1;
        this._checkQuorum();
    }

    onMemberReachable(memberUuid: string): void {
        this._reachableMembers.add(memberUuid);
        this._checkQuorum();
    }

    onMemberUnreachable(memberUuid: string): void {
        this._reachableMembers.delete(memberUuid);
        this._checkQuorum();
    }

    isReadOnly(): boolean {
        return this._readOnlyMode;
    }

    /** @throws Error if in read-only mode */
    checkNotReadOnly(): void {
        if (this._readOnlyMode) {
            throw new Error(
                'Cluster is in read-only mode: split-brain detected ' +
                `(${this._reachableMembers.size} reachable < ${this._quorumSize} quorum)`,
            );
        }
    }

    private _checkQuorum(): void {
        if (this._reachableMembers.size >= this._quorumSize) {
            this._readOnlyMode = false;
        } else {
            this._readOnlyMode = true;
        }
    }
}
