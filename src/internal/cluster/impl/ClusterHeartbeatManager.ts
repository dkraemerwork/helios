/**
 * Port of {@code com.hazelcast.internal.cluster.impl.ClusterHeartbeatManager}.
 *
 * Manages periodic heartbeat sending, failure detection via DeadlineClusterFailureDetector,
 * clock drift detection, and cooperative yielding.
 *
 * Ref: ClusterHeartbeatManager.java (760 lines)
 */
import type { MemberImpl } from '@zenystx/core/cluster/impl/MemberImpl';
import type { ClusterServiceImpl } from '@zenystx/core/internal/cluster/impl/ClusterServiceImpl';
import { DeadlineClusterFailureDetector } from '@zenystx/core/internal/cluster/impl/DeadlineClusterFailureDetector';

const CLOCK_JUMP_THRESHOLD = 120_000; // 2 minutes

export interface HeartbeatConfig {
    heartbeatIntervalMillis: number; // default 5000
    maxNoHeartbeatMillis: number;    // default 60000
}

type HeartbeatSentCallback = (member: MemberImpl) => void;

export class ClusterHeartbeatManager {
    private readonly _clusterService: ClusterServiceImpl;
    private readonly _config: HeartbeatConfig;
    private readonly _failureDetector: DeadlineClusterFailureDetector;
    private _intervalHandle: ReturnType<typeof setInterval> | null = null;
    private _lastHeartbeatTime: number = Date.now();
    private readonly _sentCallbacks: HeartbeatSentCallback[] = [];

    constructor(clusterService: ClusterServiceImpl, config: HeartbeatConfig) {
        this._clusterService = clusterService;
        this._config = config;
        this._failureDetector = new DeadlineClusterFailureDetector(config.maxNoHeartbeatMillis);
    }

    /** Starts the periodic heartbeat interval. */
    init(): void {
        if (this._intervalHandle !== null) return;
        this._lastHeartbeatTime = Date.now();
        this._intervalHandle = setInterval(() => {
            this.runHeartbeatCycle();
        }, this._config.heartbeatIntervalMillis);
    }

    shutdown(): void {
        if (this._intervalHandle !== null) {
            clearInterval(this._intervalHandle);
            this._intervalHandle = null;
        }
    }

    /** Register a callback invoked when a heartbeat is sent to a member. */
    onHeartbeatSent(cb: HeartbeatSentCallback): void {
        this._sentCallbacks.push(cb);
    }

    /**
     * Core periodic heartbeat cycle (matching Java's heartbeat()).
     * 1. If not joined: return
     * 2. Check clock drift
     * 3. For each non-local member: check suspicion, send heartbeat
     */
    runHeartbeatCycle(): void {
        if (!this._clusterService.isJoined()) return;

        const now = Date.now();
        this.checkClockDrift(now);

        const localUuid = this._clusterService.getLocalMember().getUuid();
        for (const member of this._clusterService.getMembers()) {
            const m = member as MemberImpl;
            if (m.getUuid() === localUuid) continue;

            this.suspectMemberIfNotHeartBeating(m, now);

            // "Send" heartbeat (in real implementation, sends HeartbeatOp)
            for (const cb of this._sentCallbacks) {
                cb(m);
            }
        }
    }

    /**
     * Called when a heartbeat is received from a member.
     * Validates the sender is a known member, records heartbeat, clears suspicion.
     */
    onHeartbeat(member: MemberImpl, timestamp: number): void {
        const known = this._clusterService.getMemberByUuid(member.getUuid());
        if (known === null) {
            throw new Error(`Heartbeat from unknown member: ${member.getUuid()}`);
        }
        this._failureDetector.heartbeat(member.getUuid(), timestamp);
        this._clusterService.clearSuspicion(member);
    }

    /**
     * Checks if a member's heartbeat has timed out and suspects it if so.
     * @returns true if the member was suspected
     */
    suspectMemberIfNotHeartBeating(member: MemberImpl, now: number): boolean {
        if (!this._failureDetector.isAlive(member.getUuid(), now)) {
            this._clusterService.suspectMember(member);
            return true;
        }
        return false;
    }

    /** Check if a member is alive according to the failure detector. */
    isMemberAlive(member: MemberImpl, now?: number): boolean {
        return this._failureDetector.isAlive(member.getUuid(), now ?? Date.now());
    }

    /**
     * Detect system clock jumps > CLOCK_JUMP_THRESHOLD.
     * If jump >= maxNoHeartbeatMillis / 2, reset all heartbeat timestamps
     * to prevent false positive suspicions.
     */
    checkClockDrift(now: number): void {
        const elapsed = now - this._lastHeartbeatTime;
        this._lastHeartbeatTime = now;

        if (elapsed > CLOCK_JUMP_THRESHOLD) {
            if (elapsed >= this._config.maxNoHeartbeatMillis / 2) {
                this._failureDetector.reset(now);
            }
        }
    }
}
