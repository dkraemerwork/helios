/**
 * Port of {@code com.hazelcast.internal.cluster.fd.DeadlineClusterFailureDetector}.
 *
 * Simple deadline-based failure detector: a member is alive if its last heartbeat
 * was received within `maxNoHeartbeatMillis` of the current time.
 */
export class DeadlineClusterFailureDetector {
    private readonly _maxNoHeartbeatMillis: number;
    private readonly _lastHeartbeats: Map<string, number> = new Map(); // uuid → timestamp

    constructor(maxNoHeartbeatMillis: number) {
        this._maxNoHeartbeatMillis = maxNoHeartbeatMillis;
    }

    heartbeat(memberUuid: string, timestamp: number): void {
        this._lastHeartbeats.set(memberUuid, timestamp);
    }

    isAlive(memberUuid: string, now: number): boolean {
        const last = this._lastHeartbeats.get(memberUuid);
        if (last === undefined) return false;
        return (now - last) < this._maxNoHeartbeatMillis;
    }

    /** Resets all heartbeat timestamps to the given time. Used after clock drift detection. */
    reset(now: number): void {
        for (const uuid of this._lastHeartbeats.keys()) {
            this._lastHeartbeats.set(uuid, now);
        }
    }

    remove(memberUuid: string): void {
        this._lastHeartbeats.delete(memberUuid);
    }
}
