/**
 * Named quorum configuration for split-brain protection.
 *
 * Port of {@code com.hazelcast.config.SplitBrainProtectionConfig}.
 *
 * A protection config is referenced by name from data-structure configs
 * (e.g. MapConfig.splitBrainProtectionName). The SplitBrainProtectionServiceImpl
 * evaluates the quorum on every membership change and blocks operations on
 * data structures whose protection requirement is not satisfied.
 */

/**
 * Enum controlling which operation types are blocked when quorum is not met.
 *
 * Port of {@code com.hazelcast.splitbrainprotection.SplitBrainProtectionOn}.
 */
export enum SplitBrainProtectionOn {
    /** Block write operations (put, remove, set, …) when quorum is not met. */
    WRITE = 'WRITE',
    /** Block read operations (get, containsKey, size, …) when quorum is not met. */
    READ = 'READ',
    /** Block both read and write operations when quorum is not met. */
    READ_WRITE = 'READ_WRITE',
}

/**
 * Function-class name for the quorum evaluation strategy.
 *
 * Port of {@code com.hazelcast.config.SplitBrainProtectionConfig} function names.
 */
export enum SplitBrainProtectionFunctionType {
    /**
     * Simple member-count check: quorum is met when
     * {@code clusterSize >= minimumClusterSize}.
     */
    MEMBER_COUNT = 'MEMBER_COUNT',
    /**
     * Phi-accrual failure detector: quorum is met when all reachable
     * members have a phi value below the configured threshold.
     */
    PROBABILISTIC = 'PROBABILISTIC',
    /**
     * Heartbeat-age check: quorum is met when all members sent a
     * heartbeat within the configured tolerance window.
     */
    RECENTLY_ACTIVE = 'RECENTLY_ACTIVE',
}

/**
 * Base split-brain protection configuration.
 *
 * Use {@link ProbabilisticSplitBrainProtectionConfig} or
 * {@link RecentlyActiveSplitBrainProtectionConfig} for advanced strategies.
 */
export class SplitBrainProtectionConfig {
    /** Human-readable name used as lookup key in HeliosConfig. */
    protected _name: string;
    /** Whether this protection is active. Defaults to {@code true}. */
    protected _enabled: boolean = true;
    /**
     * Minimum number of reachable members (including self) required for
     * quorum. 0 means the protection is effectively disabled.
     */
    protected _minimumClusterSize: number = 0;
    /** Which operation types are subject to quorum enforcement. */
    protected _protectOn: SplitBrainProtectionOn = SplitBrainProtectionOn.WRITE;
    /** Quorum evaluation strategy. */
    protected _functionType: SplitBrainProtectionFunctionType = SplitBrainProtectionFunctionType.MEMBER_COUNT;

    constructor(name: string) {
        if (!name || name.trim() === '') {
            throw new Error('SplitBrainProtectionConfig name must be a non-empty string');
        }
        this._name = name;
    }

    getName(): string {
        return this._name;
    }

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    getMinimumClusterSize(): number {
        return this._minimumClusterSize;
    }

    setMinimumClusterSize(minimumClusterSize: number): this {
        if (minimumClusterSize < 0) {
            throw new Error(`minimumClusterSize must be >= 0, got: ${minimumClusterSize}`);
        }
        this._minimumClusterSize = minimumClusterSize;
        return this;
    }

    getProtectOn(): SplitBrainProtectionOn {
        return this._protectOn;
    }

    setProtectOn(protectOn: SplitBrainProtectionOn): this {
        this._protectOn = protectOn;
        return this;
    }

    getFunctionType(): SplitBrainProtectionFunctionType {
        return this._functionType;
    }

    setFunctionType(functionType: SplitBrainProtectionFunctionType): this {
        this._functionType = functionType;
        return this;
    }
}

/**
 * Split-brain protection config using the phi-accrual failure detector strategy.
 *
 * The phi-accrual detector models the arrival time distribution of heartbeats
 * per member using an exponentially-weighted moving average (EWMA). The "phi"
 * value rises continuously as time elapses without a heartbeat; quorum is
 * withdrawn when phi exceeds {@link accrualThreshold}.
 *
 * Port of {@code com.hazelcast.config.ProbabilisticSplitBrainProtectionConfig}.
 */
export class ProbabilisticSplitBrainProtectionConfig extends SplitBrainProtectionConfig {
    /**
     * Phi threshold above which a member is considered suspect.
     * Hazelcast default: 10.
     */
    private _accrualThreshold: number = 10;
    /**
     * Number of heartbeat samples used to bootstrap the inter-arrival
     * time distribution. Hazelcast default: 200.
     */
    private _maxSampleSize: number = 200;
    /**
     * The minimum standard deviation (ms) assumed for heartbeat
     * inter-arrival times, preventing unrealistically narrow distributions.
     * Hazelcast default: 100.
     */
    private _minStdDeviationMillis: number = 100;
    /**
     * If a member's last heartbeat is older than this (ms), it is
     * treated as heartbeat-timeout-failed regardless of phi.
     * Hazelcast default: 60_000.
     */
    private _heartbeatIntervalMillis: number = 5_000;
    /**
     * Maximum time (ms) a member may be silent before being declared
     * unreachable. Hazelcast default: 60_000.
     */
    private _maxNoHeartbeatMillis: number = 60_000;

    constructor(name: string) {
        super(name);
        this._functionType = SplitBrainProtectionFunctionType.PROBABILISTIC;
    }

    getAccrualThreshold(): number {
        return this._accrualThreshold;
    }

    setAccrualThreshold(threshold: number): this {
        if (threshold <= 0) {
            throw new Error(`accrualThreshold must be > 0, got: ${threshold}`);
        }
        this._accrualThreshold = threshold;
        return this;
    }

    getMaxSampleSize(): number {
        return this._maxSampleSize;
    }

    setMaxSampleSize(size: number): this {
        if (size < 1) {
            throw new Error(`maxSampleSize must be >= 1, got: ${size}`);
        }
        this._maxSampleSize = size;
        return this;
    }

    getMinStdDeviationMillis(): number {
        return this._minStdDeviationMillis;
    }

    setMinStdDeviationMillis(millis: number): this {
        if (millis < 0) {
            throw new Error(`minStdDeviationMillis must be >= 0, got: ${millis}`);
        }
        this._minStdDeviationMillis = millis;
        return this;
    }

    getHeartbeatIntervalMillis(): number {
        return this._heartbeatIntervalMillis;
    }

    setHeartbeatIntervalMillis(millis: number): this {
        if (millis <= 0) {
            throw new Error(`heartbeatIntervalMillis must be > 0, got: ${millis}`);
        }
        this._heartbeatIntervalMillis = millis;
        return this;
    }

    getMaxNoHeartbeatMillis(): number {
        return this._maxNoHeartbeatMillis;
    }

    setMaxNoHeartbeatMillis(millis: number): this {
        if (millis <= 0) {
            throw new Error(`maxNoHeartbeatMillis must be > 0, got: ${millis}`);
        }
        this._maxNoHeartbeatMillis = millis;
        return this;
    }
}

/**
 * Split-brain protection config using the recently-active heartbeat strategy.
 *
 * Quorum is met when every reachable cluster member has sent a heartbeat
 * within the last {@link heartbeatToleranceMillis} milliseconds.
 *
 * Port of {@code com.hazelcast.config.RecentlyActiveSplitBrainProtectionConfig}.
 */
export class RecentlyActiveSplitBrainProtectionConfig extends SplitBrainProtectionConfig {
    /**
     * Maximum age (ms) of the most-recent heartbeat for a member to be
     * considered "recently active". Hazelcast default: 60_000.
     */
    private _heartbeatToleranceMillis: number = 60_000;

    constructor(name: string) {
        super(name);
        this._functionType = SplitBrainProtectionFunctionType.RECENTLY_ACTIVE;
    }

    getHeartbeatToleranceMillis(): number {
        return this._heartbeatToleranceMillis;
    }

    setHeartbeatToleranceMillis(millis: number): this {
        if (millis <= 0) {
            throw new Error(`heartbeatToleranceMillis must be > 0, got: ${millis}`);
        }
        this._heartbeatToleranceMillis = millis;
        return this;
    }
}
