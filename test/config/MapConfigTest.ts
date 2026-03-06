import { describe, it, expect } from 'bun:test';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { EvictionPolicy } from '@zenystx/helios-core/config/EvictionPolicy';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';

describe('MapConfigTest', () => {

    it('testGetName', () => {
        expect(new MapConfig().getName()).toBeNull();
    });

    it('testSetName', () => {
        expect(new MapConfig().setName('map-test-name').getName()).toBe('map-test-name');
    });

    it('testGetBackupCount', () => {
        expect(new MapConfig().getBackupCount()).toBe(MapConfig.DEFAULT_BACKUP_COUNT);
    });

    it('testSetBackupCount', () => {
        expect(new MapConfig().setBackupCount(0).getBackupCount()).toBe(0);
        expect(new MapConfig().setBackupCount(1).getBackupCount()).toBe(1);
        expect(new MapConfig().setBackupCount(2).getBackupCount()).toBe(2);
        expect(new MapConfig().setBackupCount(3).getBackupCount()).toBe(3);
    });

    it('testSetBackupCountLowerLimit', () => {
        expect(() => new MapConfig().setBackupCount(MapConfig.MIN_BACKUP_COUNT - 1)).toThrow();
    });

    it('testGetTimeToLiveSeconds', () => {
        expect(new MapConfig().getTimeToLiveSeconds()).toBe(MapConfig.DEFAULT_TTL_SECONDS);
    });

    it('testSetTimeToLiveSeconds', () => {
        expect(new MapConfig().setTimeToLiveSeconds(1234).getTimeToLiveSeconds()).toBe(1234);
    });

    it('testGetMaxIdleSeconds', () => {
        expect(new MapConfig().getMaxIdleSeconds()).toBe(MapConfig.DEFAULT_MAX_IDLE_SECONDS);
    });

    it('testSetMaxIdleSeconds', () => {
        expect(new MapConfig().setMaxIdleSeconds(1234).getMaxIdleSeconds()).toBe(1234);
    });

    it('testGetMaxSize', () => {
        expect(new MapConfig().getEvictionConfig().getSize()).toBe(MapConfig.DEFAULT_MAX_SIZE);
    });

    it('testSetMaxSize', () => {
        expect(new MapConfig().getEvictionConfig().setSize(1234).getSize()).toBe(1234);
    });

    it('testSetMaxSizeCannotBeNegative', () => {
        expect(() => new MapConfig().getEvictionConfig().setSize(-1)).toThrow();
    });

    it('testGetEvictionPolicy', () => {
        expect(new MapConfig().getEvictionConfig().getEvictionPolicy()).toBe(MapConfig.DEFAULT_EVICTION_POLICY);
    });

    it('testSetEvictionPolicy', () => {
        expect(
            new MapConfig().getEvictionConfig()
                .setEvictionPolicy(EvictionPolicy.LRU)
                .getEvictionPolicy()
        ).toBe(EvictionPolicy.LRU);
    });

    it('testGetMapStoreConfig', () => {
        const mapStoreConfig = new MapConfig().getMapStoreConfig();
        expect(mapStoreConfig).not.toBeNull();
        expect(mapStoreConfig.isEnabled()).toBe(false);
    });

    it('testSetMapStoreConfig', () => {
        const mapStoreConfig = new MapStoreConfig();
        expect(new MapConfig().setMapStoreConfig(mapStoreConfig).getMapStoreConfig()).toBe(mapStoreConfig);
    });

    it('testGetNearCacheConfig', () => {
        expect(new MapConfig().getNearCacheConfig()).toBeNull();
    });

    it('testSetNearCacheConfig', () => {
        const nearCacheConfig = new NearCacheConfig();
        expect(new MapConfig().setNearCacheConfig(nearCacheConfig).getNearCacheConfig()).toBe(nearCacheConfig);
    });

    it('setAsyncBackupCount_whenItsNegative', () => {
        expect(() => new MapConfig().setAsyncBackupCount(-1)).toThrow();
    });

    it('setAsyncBackupCount_whenItsZero', () => {
        const config = new MapConfig();
        config.setAsyncBackupCount(0);
        expect(config.getAsyncBackupCount()).toBe(0);
    });

    it('setAsyncBackupCount_whenTooLarge', () => {
        // max allowed is 6
        expect(() => new MapConfig().setAsyncBackupCount(200)).toThrow();
    });

    it('setBackupCount_whenItsNegative', () => {
        expect(() => new MapConfig().setBackupCount(-1)).toThrow();
    });

    it('setBackupCount_whenItsZero', () => {
        const config = new MapConfig();
        config.setBackupCount(0);
        expect(config.getBackupCount()).toBe(0);
    });

    it('setBackupCount_tooLarge', () => {
        // max allowed is 6
        expect(() => new MapConfig().setBackupCount(200)).toThrow();
    });

    it('testDefaultHashCode', () => {
        const mapConfig = new MapConfig();
        // Just ensure it does not throw
        expect(typeof mapConfig.hashCode()).toBe('number');
    });
});
