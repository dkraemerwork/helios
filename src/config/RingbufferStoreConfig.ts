/**
 * Port of {@code com.hazelcast.config.RingbufferStoreConfig}.
 * Configuration for RingbufferStore persistence.
 */
import type { RingbufferStore } from '@zenystx/helios-core/ringbuffer/RingbufferStore.js';
import type { RingbufferStoreFactory } from '@zenystx/helios-core/ringbuffer/RingbufferStoreFactory.js';

export class RingbufferStoreConfig {
    private _enabled = false;
    private _className: string | null = null;
    private _factoryClassName: string | null = null;
    private _storeImplementation: RingbufferStore<unknown> | null = null;
    private _factoryImplementation: RingbufferStoreFactory<unknown> | null = null;
    private _properties = new Map<string, string>();

    isEnabled(): boolean { return this._enabled; }
    setEnabled(enabled: boolean): this { this._enabled = enabled; return this; }

    getClassName(): string | null { return this._className; }
    setClassName(className: string): this { this._className = className; return this; }

    getFactoryClassName(): string | null { return this._factoryClassName; }
    setFactoryClassName(className: string): this { this._factoryClassName = className; return this; }

    getStoreImplementation(): RingbufferStore<unknown> | null { return this._storeImplementation; }
    setStoreImplementation(store: RingbufferStore<unknown>): this {
        this._storeImplementation = store;
        this._factoryImplementation = null;
        return this;
    }

    getFactoryImplementation(): RingbufferStoreFactory<unknown> | null { return this._factoryImplementation; }
    setFactoryImplementation(factory: RingbufferStoreFactory<unknown>): this {
        this._factoryImplementation = factory;
        this._storeImplementation = null;
        return this;
    }

    getProperties(): Map<string, string> { return this._properties; }
    setProperty(key: string, value: string): this { this._properties.set(key, value); return this; }
    setProperties(properties: Map<string, string>): this { this._properties = properties; return this; }
}
