/**
 * Port of {@code com.hazelcast.map.impl.recordstore.expiry.ExpiryMetadataImpl}.
 */
import type { ExpiryMetadata } from './ExpiryMetadata';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { stripBaseTime, recomputeWithBaseTime } from '@zenystx/helios-core/internal/util/TimeStripUtil';

/** Convert millis to seconds (for compact storage). */
function toSeconds(millis: number): number {
    if (millis <= 0) return 0;
    let seconds = Math.floor(millis / 1000);
    if (seconds === 0 && millis !== 0) seconds = 1;
    return seconds > 0x7fffffff ? 0x7fffffff : seconds;
}

/** Convert seconds back to millis. */
function toMillis(seconds: number): number {
    return seconds === 0x7fffffff ? Number.MAX_SAFE_INTEGER : seconds * 1000;
}

export class ExpiryMetadataImpl implements ExpiryMetadata {
    private _ttl = 0;
    private _maxIdle = 0;
    private _lastUpdateTime = 0;
    private _expirationTime = 0;

    constructor(ttl?: number, maxIdle?: number, expirationTime?: number, lastUpdateTime?: number) {
        if (ttl !== undefined) this.setTtl(ttl);
        if (maxIdle !== undefined) this.setMaxIdle(maxIdle);
        if (expirationTime !== undefined) this.setExpirationTime(expirationTime);
        if (lastUpdateTime !== undefined) this.setLastUpdateTime(lastUpdateTime);
    }

    hasExpiry(): boolean { return true; }

    getTtl(): number { return toMillis(this._ttl); }
    getRawTtl(): number { return this._ttl; }
    setTtl(ttl: number): this { this._ttl = toSeconds(ttl); return this; }
    setRawTtl(ttl: number): this { this._ttl = ttl; return this; }

    getMaxIdle(): number { return toMillis(this._maxIdle); }
    getRawMaxIdle(): number { return this._maxIdle; }
    setMaxIdle(maxIdle: number): this { this._maxIdle = toSeconds(maxIdle); return this; }
    setRawMaxIdle(maxIdle: number): this { this._maxIdle = maxIdle; return this; }

    getExpirationTime(): number { return recomputeWithBaseTime(this._expirationTime); }
    getRawExpirationTime(): number { return this._expirationTime; }
    setExpirationTime(expirationTime: number): this { this._expirationTime = stripBaseTime(expirationTime); return this; }
    setRawExpirationTime(expirationTime: number): this { this._expirationTime = expirationTime; return this; }

    getLastUpdateTime(): number { return recomputeWithBaseTime(this._lastUpdateTime); }
    getRawLastUpdateTime(): number { return this._lastUpdateTime; }
    setLastUpdateTime(lastUpdateTime: number): this { this._lastUpdateTime = stripBaseTime(lastUpdateTime); return this; }
    setRawLastUpdateTime(lastUpdateTime: number): this { this._lastUpdateTime = lastUpdateTime; return this; }

    write(out: ByteArrayObjectDataOutput): void {
        out.writeInt(this._ttl);
        out.writeInt(this._maxIdle);
        out.writeInt(this._expirationTime);
        out.writeInt(this._lastUpdateTime);
    }

    read(inp: ByteArrayObjectDataInput): void {
        this._ttl = inp.readInt();
        this._maxIdle = inp.readInt();
        this._expirationTime = inp.readInt();
        this._lastUpdateTime = inp.readInt();
    }

    toString(): string {
        return `ExpiryMetadataImpl{ttl=${this.getTtl()}, maxIdle=${this.getMaxIdle()}, expirationTime=${this.getExpirationTime()}, lastUpdateTime=${this.getLastUpdateTime()}}`;
    }
}
