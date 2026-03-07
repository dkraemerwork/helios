import { NearCachePreloaderConfig } from '@zenystx/helios-core/config/NearCachePreloaderConfig';
import { beforeEach, describe, expect, it } from 'bun:test';

describe('NearCachePreloaderConfigTest', () => {
    let config: NearCachePreloaderConfig;

    beforeEach(() => {
        config = new NearCachePreloaderConfig();
    });

    it('testConstructor_withDirectory', () => {
        config = new NearCachePreloaderConfig('myParentDirectory');
        expect(config.isEnabled()).toBe(true);
        expect(config.getDirectory()).toBe('myParentDirectory');
    });

    it('setDirectory', () => {
        config.setDirectory('myParentDirectory');
        expect(config.getDirectory()).toBe('myParentDirectory');
    });

    it('setDirectory_withNull', () => {
        expect(() => config.setDirectory(null as unknown as string)).toThrow();
    });

    it('setStoreInitialDelaySeconds', () => {
        config.setStoreInitialDelaySeconds(1);
        expect(config.getStoreInitialDelaySeconds()).toBe(1);
    });

    it('setStoreInitialDelaySeconds_withZero', () => {
        expect(() => config.setStoreInitialDelaySeconds(0)).toThrow();
    });

    it('setStoreInitialDelaySeconds_withNegative', () => {
        expect(() => config.setStoreInitialDelaySeconds(-1)).toThrow();
    });

    it('setStoreIntervalSeconds', () => {
        config.setStoreIntervalSeconds(1);
        expect(config.getStoreIntervalSeconds()).toBe(1);
    });

    it('setStoreIntervalSeconds_withZero', () => {
        expect(() => config.setStoreIntervalSeconds(0)).toThrow();
    });

    it('setStoreIntervalSeconds_withNegative', () => {
        expect(() => config.setStoreIntervalSeconds(-1)).toThrow();
    });
});
