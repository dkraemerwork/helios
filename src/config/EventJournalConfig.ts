/**
 * Port of {@code com.hazelcast.config.EventJournalConfig}.
 * Configuration for the Event Journal feature.
 */
export class EventJournalConfig {
    static readonly DEFAULT_CAPACITY = 10_000;
    static readonly DEFAULT_TTL_SECONDS = 0; // 0 = no expiration

    private _enabled = false;
    private _capacity: number = EventJournalConfig.DEFAULT_CAPACITY;
    private _timeToLiveSeconds: number = EventJournalConfig.DEFAULT_TTL_SECONDS;

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    getCapacity(): number {
        return this._capacity;
    }

    setCapacity(capacity: number): this {
        this._capacity = Math.max(1, capacity);
        return this;
    }

    getTimeToLiveSeconds(): number {
        return this._timeToLiveSeconds;
    }

    setTimeToLiveSeconds(ttl: number): this {
        this._timeToLiveSeconds = Math.max(0, ttl);
        return this;
    }
}
