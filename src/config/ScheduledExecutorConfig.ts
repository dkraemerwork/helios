import { CapacityPolicy } from "@zenystx/helios-core/config/CapacityPolicy";
import { ScheduleShutdownPolicy } from "@zenystx/helios-core/config/ScheduleShutdownPolicy";

const DEFAULT_POOL_SIZE = 16;
const DEFAULT_CAPACITY = 100;
const DEFAULT_CAPACITY_POLICY = CapacityPolicy.PER_NODE;
const DEFAULT_DURABILITY = 1;
const DEFAULT_STATISTICS_ENABLED = true;
const DEFAULT_SCHEDULE_SHUTDOWN_POLICY = ScheduleShutdownPolicy.GRACEFUL_TRANSFER;
const DEFAULT_MAX_HISTORY_ENTRIES_PER_TASK = 100;

export class ScheduledExecutorConfig {
    private readonly _name: string;
    private _poolSize: number = DEFAULT_POOL_SIZE;
    private _capacity: number = DEFAULT_CAPACITY;
    private _capacityPolicy: CapacityPolicy = DEFAULT_CAPACITY_POLICY;
    private _durability: number = DEFAULT_DURABILITY;
    private _statisticsEnabled: boolean = DEFAULT_STATISTICS_ENABLED;
    private _scheduleShutdownPolicy: ScheduleShutdownPolicy = DEFAULT_SCHEDULE_SHUTDOWN_POLICY;
    private _maxHistoryEntriesPerTask: number = DEFAULT_MAX_HISTORY_ENTRIES_PER_TASK;
    private _mergePolicyConfig: string | null = null;

    constructor(name: string) {
        this._name = name;
    }

    getName(): string {
        return this._name;
    }

    getPoolSize(): number {
        return this._poolSize;
    }

    setPoolSize(poolSize: number): this {
        if (poolSize <= 0) {
            throw new Error(`poolSize must be > 0, got ${poolSize}`);
        }
        this._poolSize = poolSize;
        return this;
    }

    getCapacity(): number {
        return this._capacity;
    }

    setCapacity(capacity: number): this {
        if (capacity < 0) {
            throw new Error(`capacity must be >= 0, got ${capacity}`);
        }
        this._capacity = capacity;
        return this;
    }

    getCapacityPolicy(): CapacityPolicy {
        return this._capacityPolicy;
    }

    setCapacityPolicy(policy: CapacityPolicy): this {
        this._capacityPolicy = policy;
        return this;
    }

    getDurability(): number {
        return this._durability;
    }

    setDurability(durability: number): this {
        if (durability < 0) {
            throw new Error(`durability must be >= 0, got ${durability}`);
        }
        this._durability = durability;
        return this;
    }

    isStatisticsEnabled(): boolean {
        return this._statisticsEnabled;
    }

    setStatisticsEnabled(enabled: boolean): this {
        this._statisticsEnabled = enabled;
        return this;
    }

    getScheduleShutdownPolicy(): ScheduleShutdownPolicy {
        return this._scheduleShutdownPolicy;
    }

    setScheduleShutdownPolicy(policy: ScheduleShutdownPolicy): this {
        this._scheduleShutdownPolicy = policy;
        return this;
    }

    getMaxHistoryEntriesPerTask(): number {
        return this._maxHistoryEntriesPerTask;
    }

    setMaxHistoryEntriesPerTask(max: number): this {
        if (max < 0) {
            throw new Error(`maxHistoryEntriesPerTask must be >= 0, got ${max}`);
        }
        this._maxHistoryEntriesPerTask = max;
        return this;
    }

    getMergePolicyConfig(): string | null {
        return this._mergePolicyConfig;
    }

    setMergePolicyConfig(policy: string): this {
        this._mergePolicyConfig = policy;
        return this;
    }
}
