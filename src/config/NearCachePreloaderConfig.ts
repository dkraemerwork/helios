export class NearCachePreloaderConfig {
    static readonly DEFAULT_STORE_INITIAL_DELAY_SECONDS = 600;
    static readonly DEFAULT_STORE_INTERVAL_SECONDS = 600;

    private _enabled: boolean = false;
    private _directory: string = '';
    private _storeInitialDelaySeconds: number = NearCachePreloaderConfig.DEFAULT_STORE_INITIAL_DELAY_SECONDS;
    private _storeIntervalSeconds: number = NearCachePreloaderConfig.DEFAULT_STORE_INTERVAL_SECONDS;

    constructor(directory?: string, enabled?: boolean) {
        if (directory !== undefined) {
            if (directory === null) {
                throw new Error('directory cannot be null');
            }
            this._directory = directory;
            this._enabled = true;
        }
        if (enabled !== undefined) {
            this._enabled = enabled;
        }
    }

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    getDirectory(): string {
        return this._directory;
    }

    setDirectory(directory: string): this {
        if (directory === null || directory === undefined) {
            throw new Error('directory cannot be null');
        }
        this._directory = directory;
        return this;
    }

    getStoreInitialDelaySeconds(): number {
        return this._storeInitialDelaySeconds;
    }

    setStoreInitialDelaySeconds(storeInitialDelaySeconds: number): this {
        if (storeInitialDelaySeconds <= 0) {
            throw new Error(`storeInitialDelaySeconds must be positive, was: ${storeInitialDelaySeconds}`);
        }
        this._storeInitialDelaySeconds = storeInitialDelaySeconds;
        return this;
    }

    getStoreIntervalSeconds(): number {
        return this._storeIntervalSeconds;
    }

    setStoreIntervalSeconds(storeIntervalSeconds: number): this {
        if (storeIntervalSeconds <= 0) {
            throw new Error(`storeIntervalSeconds must be positive, was: ${storeIntervalSeconds}`);
        }
        this._storeIntervalSeconds = storeIntervalSeconds;
        return this;
    }
}
