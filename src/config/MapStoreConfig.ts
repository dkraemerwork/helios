export enum InitialLoadMode {
    LAZY = 'LAZY',
    EAGER = 'EAGER',
}

export class MapStoreConfig {
    static readonly DEFAULT_WRITE_DELAY_SECONDS = 0;
    static readonly DEFAULT_WRITE_BATCH_SIZE = 1;
    static readonly DEFAULT_WRITE_COALESCING = true;
    static readonly DEFAULT_OFFLOAD = true;

    private _enabled: boolean = false;
    private _offload: boolean = MapStoreConfig.DEFAULT_OFFLOAD;
    private _writeCoalescing: boolean = MapStoreConfig.DEFAULT_WRITE_COALESCING;
    private _writeDelaySeconds: number = MapStoreConfig.DEFAULT_WRITE_DELAY_SECONDS;
    private _writeBatchSize: number = MapStoreConfig.DEFAULT_WRITE_BATCH_SIZE;
    private _className: string | null = null;
    private _factoryClassName: string | null = null;
    private _implementation: unknown = null;
    private _factoryImplementation: unknown = null;
    private _properties: Map<string, string> = new Map();
    private _initialLoadMode: InitialLoadMode = InitialLoadMode.LAZY;

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    isOffload(): boolean {
        return this._offload;
    }

    setOffload(offload: boolean): this {
        this._offload = offload;
        return this;
    }

    isWriteCoalescing(): boolean {
        return this._writeCoalescing;
    }

    setWriteCoalescing(writeCoalescing: boolean): this {
        this._writeCoalescing = writeCoalescing;
        return this;
    }

    getWriteDelaySeconds(): number {
        return this._writeDelaySeconds;
    }

    setWriteDelaySeconds(writeDelaySeconds: number): this {
        this._writeDelaySeconds = writeDelaySeconds;
        return this;
    }

    getWriteBatchSize(): number {
        return this._writeBatchSize;
    }

    setWriteBatchSize(writeBatchSize: number): this {
        this._writeBatchSize = writeBatchSize;
        return this;
    }

    getClassName(): string | null {
        return this._className;
    }

    setClassName(className: string): this {
        this._className = className;
        return this;
    }

    getFactoryClassName(): string | null {
        return this._factoryClassName;
    }

    setFactoryClassName(factoryClassName: string): this {
        this._factoryClassName = factoryClassName;
        return this;
    }

    getImplementation(): unknown {
        return this._implementation;
    }

    setImplementation(implementation: unknown): this {
        this._implementation = implementation;
        this._factoryImplementation = null; // mutual exclusivity: setting impl clears factory
        return this;
    }

    getFactoryImplementation(): unknown {
        return this._factoryImplementation;
    }

    setFactoryImplementation(factoryImplementation: unknown): this {
        this._factoryImplementation = factoryImplementation;
        this._implementation = null; // mutual exclusivity: setting factory clears direct impl
        return this;
    }

    setProperty(name: string, value: string): this {
        this._properties.set(name, value);
        return this;
    }

    getProperty(name: string): string | undefined {
        return this._properties.get(name);
    }

    getProperties(): Map<string, string> {
        return this._properties;
    }

    setProperties(properties: Map<string, string>): this {
        this._properties = properties;
        return this;
    }

    getInitialLoadMode(): InitialLoadMode {
        return this._initialLoadMode;
    }

    setInitialLoadMode(initialLoadMode: InitialLoadMode): this {
        this._initialLoadMode = initialLoadMode;
        return this;
    }
}
