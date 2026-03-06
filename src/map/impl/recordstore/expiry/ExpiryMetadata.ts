/**
 * Port of {@code com.hazelcast.map.impl.recordstore.expiry.ExpiryMetadata}.
 */
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';

export interface ExpiryMetadata {
    hasExpiry(): boolean;

    getTtl(): number;
    getRawTtl(): number;
    setTtl(ttl: number): this;
    setRawTtl(ttl: number): this;

    getMaxIdle(): number;
    getRawMaxIdle(): number;
    setMaxIdle(maxIdle: number): this;
    setRawMaxIdle(maxIdle: number): this;

    getExpirationTime(): number;
    getRawExpirationTime(): number;
    setExpirationTime(expirationTime: number): this;
    setRawExpirationTime(expirationTime: number): this;

    getLastUpdateTime(): number;
    getRawLastUpdateTime(): number;
    setLastUpdateTime(lastUpdateTime: number): this;
    setRawLastUpdateTime(lastUpdateTime: number): this;

    write(out: ByteArrayObjectDataOutput): void;
    read(inp: ByteArrayObjectDataInput): void;
}

/** Sentinel NULL instance — no expiry configured. */
export const NULL_EXPIRY_METADATA: ExpiryMetadata = {
    hasExpiry: () => false,
    getTtl: () => Number.MAX_SAFE_INTEGER,
    getRawTtl: () => 0x7fffffff,
    setTtl: () => { throw new Error('UnsupportedOperationException'); },
    setRawTtl: () => { throw new Error('UnsupportedOperationException'); },
    getMaxIdle: () => Number.MAX_SAFE_INTEGER,
    getRawMaxIdle: () => 0x7fffffff,
    setMaxIdle: () => { throw new Error('UnsupportedOperationException'); },
    setRawMaxIdle: () => { throw new Error('UnsupportedOperationException'); },
    getExpirationTime: () => Number.MAX_SAFE_INTEGER,
    getRawExpirationTime: () => 0x7fffffff,
    setExpirationTime: () => { throw new Error('UnsupportedOperationException'); },
    setRawExpirationTime: () => { throw new Error('UnsupportedOperationException'); },
    getLastUpdateTime: () => 0,
    getRawLastUpdateTime: () => 0,
    setLastUpdateTime: () => { throw new Error('UnsupportedOperationException'); },
    setRawLastUpdateTime: () => { throw new Error('UnsupportedOperationException'); },
    write: () => { throw new Error('UnsupportedOperationException'); },
    read: () => { throw new Error('UnsupportedOperationException'); },
};
