import { EvictionPolicy } from '@helios/config/EvictionPolicy';
import { MaxSizePolicy } from '@helios/config/MaxSizePolicy';

export class EvictionConfig {
    static readonly DEFAULT_MAX_ENTRY_COUNT = 10000;
    static readonly DEFAULT_MAX_SIZE_POLICY = MaxSizePolicy.ENTRY_COUNT;
    static readonly DEFAULT_EVICTION_POLICY = EvictionPolicy.LRU;

    private _size: number = EvictionConfig.DEFAULT_MAX_ENTRY_COUNT;
    private _maxSizePolicy: MaxSizePolicy = EvictionConfig.DEFAULT_MAX_SIZE_POLICY;
    private _evictionPolicy: EvictionPolicy = EvictionConfig.DEFAULT_EVICTION_POLICY;
    private _comparatorClassName: string | null = null;

    getSize(): number {
        return this._size;
    }

    setSize(size: number): this {
        if (size < 0) {
            throw new Error(`Size cannot be negative, was: ${size}`);
        }
        this._size = size;
        return this;
    }

    getMaxSizePolicy(): MaxSizePolicy {
        return this._maxSizePolicy;
    }

    setMaxSizePolicy(maxSizePolicy: MaxSizePolicy): this {
        this._maxSizePolicy = maxSizePolicy;
        return this;
    }

    getEvictionPolicy(): EvictionPolicy {
        return this._evictionPolicy;
    }

    setEvictionPolicy(evictionPolicy: EvictionPolicy): this {
        this._evictionPolicy = evictionPolicy;
        return this;
    }

    getComparatorClassName(): string | null {
        return this._comparatorClassName;
    }

    setComparatorClassName(comparatorClassName: string): this {
        this._comparatorClassName = comparatorClassName;
        return this;
    }
}
