/**
 * Split-brain protection service implementation.
 *
 * Maintains per-named-protection quorum state based on cluster membership
 * and heartbeat liveness, and enforces it before operation dispatch.
 *
 * Port of {@code com.hazelcast.splitbrainprotection.impl.SplitBrainProtectionServiceImpl}.
 *
 * Quorum strategies
 * ─────────────────
 * MEMBER_COUNT     – quorum iff reachableCount >= minimumClusterSize
 * PROBABILISTIC    – phi-accrual: quorum iff phi(member) < threshold for all members
 * RECENTLY_ACTIVE  – quorum iff all members' last heartbeat age < toleranceMs
 */
import {
    SplitBrainProtectionConfig,
    SplitBrainProtectionFunctionType,
    SplitBrainProtectionOn,
    type ProbabilisticSplitBrainProtectionConfig,
    type RecentlyActiveSplitBrainProtectionConfig,
} from '@zenystx/helios-core/config/SplitBrainProtectionConfig.js';
import { SplitBrainProtectionException } from '@zenystx/helios-core/core/exception/SplitBrainProtectionException.js';

// ── Phi-accrual failure detector ──────────────────────────────────────────────

/**
 * Per-member state for the phi-accrual failure detector.
 * Uses an exponentially-weighted moving average (EWMA) of heartbeat
 * inter-arrival intervals to estimate the expected next arrival time.
 */
interface PhiAccrualState {
    /** Circular buffer of the last N inter-arrival intervals (ms). */
    intervals: number[];
    /** Index into the circular buffer for the next write. */
    head: number;
    /** How many samples have been collected so far (capped at maxSampleSize). */
    count: number;
    /** Timestamp (ms) of the most recent heartbeat. */
    lastHeartbeat: number;
    /** Running sum of the interval buffer (used for fast mean calculation). */
    sum: number;
    /** Running sum of squares (used for fast variance calculation). */
    sumSq: number;
}

/**
 * Compute the phi value for a member given the current timestamp and its accrual state.
 *
 * φ(t) = -log10( 1 - CDF_exponential(elapsed) )
 *
 * where CDF_exponential(x) = 1 - exp(-x / mean).  We use a simplified
 * Gaussian approximation when we have enough samples (mean and std-dev).
 */
function computePhi(
    now: number,
    state: PhiAccrualState,
    minStdDevMs: number,
): number {
    if (state.count === 0) return 0;

    const elapsed = now - state.lastHeartbeat;
    const mean = state.sum / state.count;
    const variance = Math.max(
        state.sumSq / state.count - mean * mean,
        minStdDevMs * minStdDevMs,
    );
    const stdDev = Math.sqrt(variance);

    // Gaussian CDF approximation (Abramowitz & Stegun 26.2.17)
    const y = (elapsed - mean) / (stdDev * Math.SQRT2);
    const erfApprox = Math.sign(y) * (1 - Math.exp(-Math.abs(y) * (0.278_393 + Math.abs(y) * (0.230_389 + Math.abs(y) * (0.000_972 + Math.abs(y) * 0.078_108))) ** (-4)));
    const cdf = 0.5 * (1 + erfApprox);
    const p = Math.max(1 - cdf, Number.EPSILON);
    return -Math.log10(p);
}

function recordHeartbeat(state: PhiAccrualState, now: number, maxSamples: number): void {
    if (state.lastHeartbeat > 0) {
        const interval = now - state.lastHeartbeat;
        const slot = state.head % maxSamples;
        // Evict old sample if buffer is full
        if (state.count === maxSamples) {
            const evicted = state.intervals[slot]!;
            state.sum -= evicted;
            state.sumSq -= evicted * evicted;
        } else {
            state.count++;
        }
        state.intervals[slot] = interval;
        state.sum += interval;
        state.sumSq += interval * interval;
        state.head = (state.head + 1) % maxSamples;
    }
    state.lastHeartbeat = now;
}

function createPhiState(): PhiAccrualState {
    return { intervals: [], head: 0, count: 0, lastHeartbeat: 0, sum: 0, sumSq: 0 };
}

// ── SplitBrainProtectionServiceImpl ──────────────────────────────────────────

export interface ClusterSizeProvider {
    /** Returns the current number of live cluster members (including self). */
    getSize(): number;
    /** Returns UUIDs of all currently live members (including self). */
    getMemberIds(): ReadonlySet<string>;
}

/**
 * Main split-brain protection service.
 *
 * Lifecycle
 * 1. Construct with the map of named protection configs and a cluster-size provider.
 * 2. Call {@link onMembershipChanged} whenever the cluster view changes (member join/leave).
 * 3. Call {@link recordHeartbeat} whenever a heartbeat is received from a member.
 * 4. Call {@link ensureQuorum} before executing an operation on a protected data structure.
 */
export class SplitBrainProtectionServiceImpl {
    private readonly _configs: ReadonlyMap<string, SplitBrainProtectionConfig>;
    private readonly _clusterSizeProvider: ClusterSizeProvider;

    /**
     * Current quorum state per named protection.
     * true = quorum is met, false = quorum is not met.
     */
    private readonly _quorumState = new Map<string, boolean>();

    /**
     * Per-member phi-accrual state, keyed by member UUID.
     * Only populated for PROBABILISTIC protections.
     */
    private readonly _phiStates = new Map<string, PhiAccrualState>();

    /**
     * Per-member last-heartbeat timestamp (ms), keyed by member UUID.
     * Used for RECENTLY_ACTIVE protections.
     */
    private readonly _lastHeartbeats = new Map<string, number>();

    constructor(
        configs: ReadonlyMap<string, SplitBrainProtectionConfig>,
        clusterSizeProvider: ClusterSizeProvider,
    ) {
        this._configs = configs;
        this._clusterSizeProvider = clusterSizeProvider;
        // Initialize all quorum states to false until first evaluation
        for (const [name] of configs) {
            this._quorumState.set(name, false);
        }
        // Run initial evaluation
        this._reevaluateAll();
    }

    /**
     * Re-evaluate all named quorums.
     * Call this whenever cluster membership changes.
     */
    onMembershipChanged(): void {
        this._reevaluateAll();
    }

    /**
     * Record a heartbeat from a member. Used by PROBABILISTIC and RECENTLY_ACTIVE strategies.
     *
     * @param memberUuid — UUID of the member that sent the heartbeat
     * @param timestamp  — time the heartbeat was received (ms since epoch); defaults to Date.now()
     */
    recordHeartbeat(memberUuid: string, timestamp: number = Date.now()): void {
        // Update RECENTLY_ACTIVE tracking
        this._lastHeartbeats.set(memberUuid, timestamp);

        // Update phi-accrual state for PROBABILISTIC tracking
        let phiState = this._phiStates.get(memberUuid);
        if (phiState === undefined) {
            phiState = createPhiState();
            this._phiStates.set(memberUuid, phiState);
        }

        // Find max sample size across all probabilistic configs
        let maxSamples = 200;
        for (const [, cfg] of this._configs) {
            if (cfg.getFunctionType() === SplitBrainProtectionFunctionType.PROBABILISTIC) {
                const pCfg = cfg as ProbabilisticSplitBrainProtectionConfig;
                maxSamples = Math.max(maxSamples, pCfg.getMaxSampleSize());
            }
        }

        recordHeartbeat(phiState, timestamp, maxSamples);

        // Re-evaluate any probabilistic or recently-active protections
        this._reevaluateAll();
    }

    /**
     * Enforce quorum for a named protection and an operation type.
     *
     * @throws SplitBrainProtectionException if quorum is not met
     */
    ensureQuorum(operationType: SplitBrainProtectionOn, protectionName: string): void {
        const config = this._configs.get(protectionName);
        if (config === undefined || !config.isEnabled()) {
            return;
        }

        const protectOn = config.getProtectOn();
        const shouldEnforce = this._operationTypeMatchesProtection(operationType, protectOn);
        if (!shouldEnforce) {
            return;
        }

        const quorumMet = this._quorumState.get(protectionName) ?? false;
        if (!quorumMet) {
            const current = this._clusterSizeProvider.getSize();
            throw new SplitBrainProtectionException(
                protectionName,
                config.getMinimumClusterSize(),
                current,
            );
        }
    }

    /**
     * Returns whether quorum is currently met for a named protection.
     * Useful for health checks and monitoring.
     */
    isQuorumPresent(protectionName: string): boolean {
        return this._quorumState.get(protectionName) ?? false;
    }

    // ── private helpers ───────────────────────────────────────────────────────

    private _reevaluateAll(): void {
        for (const [name, config] of this._configs) {
            if (!config.isEnabled()) {
                this._quorumState.set(name, true);
                continue;
            }
            this._quorumState.set(name, this._evaluate(config));
        }
    }

    private _evaluate(config: SplitBrainProtectionConfig): boolean {
        const minSize = config.getMinimumClusterSize();
        if (minSize === 0) {
            // 0 means disabled — always satisfied
            return true;
        }

        switch (config.getFunctionType()) {
            case SplitBrainProtectionFunctionType.MEMBER_COUNT:
                return this._evaluateMemberCount(minSize);

            case SplitBrainProtectionFunctionType.PROBABILISTIC:
                return this._evaluateProbabilistic(
                    config as ProbabilisticSplitBrainProtectionConfig,
                    minSize,
                );

            case SplitBrainProtectionFunctionType.RECENTLY_ACTIVE:
                return this._evaluateRecentlyActive(
                    config as RecentlyActiveSplitBrainProtectionConfig,
                    minSize,
                );

            default:
                return this._evaluateMemberCount(minSize);
        }
    }

    private _evaluateMemberCount(minSize: number): boolean {
        return this._clusterSizeProvider.getSize() >= minSize;
    }

    private _evaluateProbabilistic(
        config: ProbabilisticSplitBrainProtectionConfig,
        minSize: number,
    ): boolean {
        const memberIds = this._clusterSizeProvider.getMemberIds();
        if (memberIds.size < minSize) {
            return false;
        }

        const now = Date.now();
        const threshold = config.getAccrualThreshold();
        const minStdDev = config.getMinStdDeviationMillis();
        const maxNoHeartbeat = config.getMaxNoHeartbeatMillis();

        let reachableCount = 0;
        for (const memberId of memberIds) {
            const state = this._phiStates.get(memberId);
            if (state === undefined || state.lastHeartbeat === 0) {
                // No heartbeat seen yet — treat as reachable (benefit of the doubt on startup)
                reachableCount++;
                continue;
            }

            // Hard timeout: if no heartbeat within maxNoHeartbeatMillis, member is unreachable
            if (now - state.lastHeartbeat > maxNoHeartbeat) {
                continue;
            }

            const phi = computePhi(now, state, minStdDev);
            if (phi < threshold) {
                reachableCount++;
            }
        }

        return reachableCount >= minSize;
    }

    private _evaluateRecentlyActive(
        config: RecentlyActiveSplitBrainProtectionConfig,
        minSize: number,
    ): boolean {
        const memberIds = this._clusterSizeProvider.getMemberIds();
        if (memberIds.size < minSize) {
            return false;
        }

        const now = Date.now();
        const toleranceMs = config.getHeartbeatToleranceMillis();

        let reachableCount = 0;
        for (const memberId of memberIds) {
            const lastSeen = this._lastHeartbeats.get(memberId);
            if (lastSeen === undefined) {
                // No heartbeat recorded yet — treat as reachable on startup
                reachableCount++;
                continue;
            }
            if (now - lastSeen <= toleranceMs) {
                reachableCount++;
            }
        }

        return reachableCount >= minSize;
    }

    /**
     * Returns true when the protection config's {@code protectOn} setting
     * covers the supplied {@code operationType}.
     */
    private _operationTypeMatchesProtection(
        operationType: SplitBrainProtectionOn,
        protectOn: SplitBrainProtectionOn,
    ): boolean {
        if (protectOn === SplitBrainProtectionOn.READ_WRITE) {
            return true;
        }
        return operationType === protectOn;
    }
}
