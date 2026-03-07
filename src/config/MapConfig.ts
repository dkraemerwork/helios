import { EvictionConfig } from '@zenystx/helios-core/config/EvictionConfig';
import { EvictionPolicy } from '@zenystx/helios-core/config/EvictionPolicy';
import type { IndexConfig } from '@zenystx/helios-core/config/IndexConfig';
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { MaxSizePolicy } from '@zenystx/helios-core/config/MaxSizePolicy';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';

export class MapConfig {
    static readonly MIN_BACKUP_COUNT = 0;
    static readonly DEFAULT_BACKUP_COUNT = 1;
    static readonly MAX_BACKUP_COUNT = 6;
    static readonly DISABLED_TTL_SECONDS = 0;
    static readonly DEFAULT_TTL_SECONDS = 0;
    static readonly DEFAULT_MAX_IDLE_SECONDS = 0;
    static readonly DEFAULT_IN_MEMORY_FORMAT = InMemoryFormat.BINARY;
    static readonly DEFAULT_MAX_SIZE = Number.MAX_SAFE_INTEGER;
    static readonly DEFAULT_MAX_SIZE_POLICY = MaxSizePolicy.PER_NODE;
    static readonly DEFAULT_EVICTION_POLICY = EvictionPolicy.NONE;
    static readonly DEFAULT_STATISTICS_ENABLED = true;
    static readonly DEFAULT_ENTRY_STATS_ENABLED = false;

    private _name: string | null = null;
    private _backupCount: number = MapConfig.DEFAULT_BACKUP_COUNT;
    private _asyncBackupCount: number = 0;
    private _timeToLiveSeconds: number = MapConfig.DEFAULT_TTL_SECONDS;
    private _maxIdleSeconds: number = MapConfig.DEFAULT_MAX_IDLE_SECONDS;
    private _inMemoryFormat: InMemoryFormat = MapConfig.DEFAULT_IN_MEMORY_FORMAT;
    private _evictionConfig: EvictionConfig;
    private _mapStoreConfig: MapStoreConfig = new MapStoreConfig();
    private _nearCacheConfig: NearCacheConfig | null = null;
    private _statisticsEnabled: boolean = MapConfig.DEFAULT_STATISTICS_ENABLED;
    private _perEntryStatsEnabled: boolean = MapConfig.DEFAULT_ENTRY_STATS_ENABLED;
    private _readBackupData: boolean = false;
    private _splitBrainProtectionName: string | null = null;
    private _indexConfigs: IndexConfig[] = [];

    constructor(name?: string) {
        // Initialize eviction config with map defaults
        this._evictionConfig = new EvictionConfig();
        this._evictionConfig.setSize(MapConfig.DEFAULT_MAX_SIZE);
        this._evictionConfig.setMaxSizePolicy(MapConfig.DEFAULT_MAX_SIZE_POLICY);
        this._evictionConfig.setEvictionPolicy(MapConfig.DEFAULT_EVICTION_POLICY);

        if (name !== undefined) {
            this._name = name;
        }
    }

    getName(): string | null {
        return this._name;
    }

    setName(name: string): this {
        this._name = name;
        return this;
    }

    getBackupCount(): number {
        return this._backupCount;
    }

    setBackupCount(backupCount: number): this {
        if (backupCount < MapConfig.MIN_BACKUP_COUNT) {
            throw new Error(`backupCount must be >= ${MapConfig.MIN_BACKUP_COUNT}, was: ${backupCount}`);
        }
        if (backupCount > MapConfig.MAX_BACKUP_COUNT) {
            throw new Error(`backupCount must be <= ${MapConfig.MAX_BACKUP_COUNT}, was: ${backupCount}`);
        }
        this._backupCount = backupCount;
        return this;
    }

    getAsyncBackupCount(): number {
        return this._asyncBackupCount;
    }

    setAsyncBackupCount(asyncBackupCount: number): this {
        if (asyncBackupCount < 0) {
            throw new Error(`asyncBackupCount must be >= 0, was: ${asyncBackupCount}`);
        }
        if (asyncBackupCount > MapConfig.MAX_BACKUP_COUNT) {
            throw new Error(`asyncBackupCount must be <= ${MapConfig.MAX_BACKUP_COUNT}, was: ${asyncBackupCount}`);
        }
        this._asyncBackupCount = asyncBackupCount;
        return this;
    }

    getTimeToLiveSeconds(): number {
        return this._timeToLiveSeconds;
    }

    setTimeToLiveSeconds(timeToLiveSeconds: number): this {
        this._timeToLiveSeconds = timeToLiveSeconds;
        return this;
    }

    getMaxIdleSeconds(): number {
        return this._maxIdleSeconds;
    }

    setMaxIdleSeconds(maxIdleSeconds: number): this {
        this._maxIdleSeconds = maxIdleSeconds;
        return this;
    }

    getInMemoryFormat(): InMemoryFormat {
        return this._inMemoryFormat;
    }

    setInMemoryFormat(inMemoryFormat: InMemoryFormat): this {
        this._inMemoryFormat = inMemoryFormat;
        return this;
    }

    getEvictionConfig(): EvictionConfig {
        return this._evictionConfig;
    }

    setEvictionConfig(evictionConfig: EvictionConfig): this {
        this._evictionConfig = evictionConfig;
        return this;
    }

    getMapStoreConfig(): MapStoreConfig {
        return this._mapStoreConfig;
    }

    setMapStoreConfig(mapStoreConfig: MapStoreConfig): this {
        this._mapStoreConfig = mapStoreConfig;
        return this;
    }

    getNearCacheConfig(): NearCacheConfig | null {
        return this._nearCacheConfig;
    }

    setNearCacheConfig(nearCacheConfig: NearCacheConfig): this {
        this._nearCacheConfig = nearCacheConfig;
        return this;
    }

    isStatisticsEnabled(): boolean {
        return this._statisticsEnabled;
    }

    setStatisticsEnabled(statisticsEnabled: boolean): this {
        this._statisticsEnabled = statisticsEnabled;
        return this;
    }

    isPerEntryStatsEnabled(): boolean {
        return this._perEntryStatsEnabled;
    }

    setPerEntryStatsEnabled(perEntryStatsEnabled: boolean): this {
        this._perEntryStatsEnabled = perEntryStatsEnabled;
        return this;
    }

    isReadBackupData(): boolean {
        return this._readBackupData;
    }

    setReadBackupData(readBackupData: boolean): this {
        this._readBackupData = readBackupData;
        return this;
    }

    getSplitBrainProtectionName(): string | null {
        return this._splitBrainProtectionName;
    }

    setSplitBrainProtectionName(splitBrainProtectionName: string): this {
        this._splitBrainProtectionName = splitBrainProtectionName;
        return this;
    }

    getIndexConfigs(): IndexConfig[] {
        return [...this._indexConfigs];
    }

    setIndexConfigs(indexConfigs: IndexConfig[]): this {
        this._indexConfigs = [...indexConfigs];
        return this;
    }

    addIndexConfig(indexConfig: IndexConfig): this {
        this._indexConfigs.push(indexConfig);
        return this;
    }

    hashCode(): number {
        let hash = 17;
        hash = hash * 31 + (this._name ? this._name.length : 0);
        hash = hash * 31 + this._backupCount;
        hash = hash * 31 + this._asyncBackupCount;
        hash = hash * 31 + this._timeToLiveSeconds;
        return hash;
    }
}
