/**
 * Port of {@code com.hazelcast.config.QueueStoreConfig}.
 * Configuration for QueueStore persistence.
 */
import type { QueueStore } from '@zenystx/helios-core/collection/QueueStore.js';
import type { QueueStoreFactory } from '@zenystx/helios-core/collection/QueueStoreFactory.js';

export class QueueStoreConfig {
    private _enabled = false;
    private _className: string | null = null;
    private _factoryClassName: string | null = null;
    private _storeImplementation: QueueStore<unknown> | null = null;
    private _factoryImplementation: QueueStoreFactory<unknown> | null = null;
    private _properties = new Map<string, string>();

    isEnabled(): boolean { return this._enabled; }
    setEnabled(enabled: boolean): this { this._enabled = enabled; return this; }

    getClassName(): string | null { return this._className; }
    setClassName(className: string): this { this._className = className; return this; }

    getFactoryClassName(): string | null { return this._factoryClassName; }
    setFactoryClassName(className: string): this { this._factoryClassName = className; return this; }

    getStoreImplementation(): QueueStore<unknown> | null { return this._storeImplementation; }
    setStoreImplementation(store: QueueStore<unknown>): this {
        this._storeImplementation = store;
        this._factoryImplementation = null;
        return this;
    }

    getFactoryImplementation(): QueueStoreFactory<unknown> | null { return this._factoryImplementation; }
    setFactoryImplementation(factory: QueueStoreFactory<unknown>): this {
        this._factoryImplementation = factory;
        this._storeImplementation = null;
        return this;
    }

    getProperties(): Map<string, string> { return this._properties; }
    setProperty(key: string, value: string): this { this._properties.set(key, value); return this; }
    setProperties(properties: Map<string, string>): this { this._properties = properties; return this; }
}
