import { InMemoryFormat } from '@helios/config/InMemoryFormat';

/**
 * Port of {@code com.hazelcast.config.RingbufferConfig}.
 *
 * Configuration for a Ringbuffer data structure.
 */
export class RingbufferConfig {
    static readonly DEFAULT_CAPACITY = 10_000;
    static readonly DEFAULT_BACKUP_COUNT = 1;
    static readonly DEFAULT_ASYNC_BACKUP_COUNT = 0;
    static readonly DEFAULT_TTL_SECONDS = 0;
    static readonly DEFAULT_IN_MEMORY_FORMAT = InMemoryFormat.BINARY;

    private _name: string;
    private _capacity: number;
    private _backupCount: number;
    private _asyncBackupCount: number;
    private _timeToLiveSeconds: number;
    private _inMemoryFormat: InMemoryFormat;

    constructor(name: string) {
        this._name = name;
        this._capacity = RingbufferConfig.DEFAULT_CAPACITY;
        this._backupCount = RingbufferConfig.DEFAULT_BACKUP_COUNT;
        this._asyncBackupCount = RingbufferConfig.DEFAULT_ASYNC_BACKUP_COUNT;
        this._timeToLiveSeconds = RingbufferConfig.DEFAULT_TTL_SECONDS;
        this._inMemoryFormat = RingbufferConfig.DEFAULT_IN_MEMORY_FORMAT;
    }

    getName(): string { return this._name; }

    getCapacity(): number { return this._capacity; }
    setCapacity(capacity: number): this {
        if (capacity <= 0) throw new Error(`capacity must be positive, got: ${capacity}`);
        this._capacity = capacity;
        return this;
    }

    getBackupCount(): number { return this._backupCount; }
    setBackupCount(backupCount: number): this {
        this._backupCount = backupCount;
        return this;
    }

    getAsyncBackupCount(): number { return this._asyncBackupCount; }
    setAsyncBackupCount(asyncBackupCount: number): this {
        this._asyncBackupCount = asyncBackupCount;
        return this;
    }

    getTimeToLiveSeconds(): number { return this._timeToLiveSeconds; }
    setTimeToLiveSeconds(timeToLiveSeconds: number): this {
        if (timeToLiveSeconds < 0) throw new Error(`timeToLiveSeconds must be >= 0, got: ${timeToLiveSeconds}`);
        this._timeToLiveSeconds = timeToLiveSeconds;
        return this;
    }

    getInMemoryFormat(): InMemoryFormat { return this._inMemoryFormat; }
    setInMemoryFormat(inMemoryFormat: InMemoryFormat): this {
        this._inMemoryFormat = inMemoryFormat;
        return this;
    }

    /** User code namespace - not used in TypeScript, returns null. */
    getUserCodeNamespace(): string | null { return null; }
}
