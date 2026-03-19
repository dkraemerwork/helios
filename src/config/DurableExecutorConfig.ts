/**
 * Configuration for a named durable executor service.
 *
 * Durable executors store task submission records in a per-partition ringbuffer
 * so that task results survive member failure. The capacity controls how many
 * in-flight or recently-completed results are retained per partition before
 * older entries are evicted.
 *
 * Mirrors Hazelcast DurableExecutorConfig with Helios-specific extensions.
 */

const DEFAULT_POOL_SIZE = 16;
const DEFAULT_CAPACITY = 100;
const DEFAULT_DURABILITY = 1;

export class DurableExecutorConfig {
    private readonly _name: string;
    private _poolSize: number = DEFAULT_POOL_SIZE;
    private _capacity: number = DEFAULT_CAPACITY;
    private _durability: number = DEFAULT_DURABILITY;
    private _statisticsEnabled: boolean = true;
    private _splitBrainProtectionName: string | null = null;

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

    /**
     * Returns the ringbuffer capacity per partition.
     * Controls how many task submission records are retained before older
     * entries are evicted (LIFO eviction on overflow).
     */
    getCapacity(): number {
        return this._capacity;
    }

    setCapacity(capacity: number): this {
        if (capacity <= 0) {
            throw new Error(`capacity must be > 0, got ${capacity}`);
        }
        this._capacity = capacity;
        return this;
    }

    /**
     * Returns the backup count for task submission records.
     * Higher values increase durability at the cost of additional memory.
     */
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

    getSplitBrainProtectionName(): string | null {
        return this._splitBrainProtectionName;
    }

    /** @throws Error Split-brain protection is not supported for durable executors in Phase 17 Tier 1. */
    setSplitBrainProtectionName(name: string): this {
        throw new Error(
            `Split-brain protection ("${name}") is not supported for durable executors in Phase 17 Tier 1. ` +
            'Remove splitBrainProtectionName from your DurableExecutorConfig.',
        );
    }
}
