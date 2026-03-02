import { describe, it, expect, beforeEach } from 'bun:test';
import { NearCacheConfig } from '@helios/config/NearCacheConfig';
import { NearCachePreloaderConfig } from '@helios/config/NearCachePreloaderConfig';
import { EvictionConfig } from '@helios/config/EvictionConfig';
import { EvictionPolicy } from '@helios/config/EvictionPolicy';
import { InMemoryFormat } from '@helios/config/InMemoryFormat';
import { MaxSizePolicy } from '@helios/config/MaxSizePolicy';

describe('NearCacheConfigTest', () => {
    let config: NearCacheConfig;

    beforeEach(() => {
        config = new NearCacheConfig();
    });

    it('testConstructor_withName', () => {
        config = new NearCacheConfig('foobar');
        expect(config.getName()).toBe('foobar');
    });

    it('testConstructor_withMultipleParameters', () => {
        config = new NearCacheConfig();
        config.setTimeToLiveSeconds(23);
        config.setMaxIdleSeconds(42);
        config.setInvalidateOnChange(true);
        config.setInMemoryFormat(InMemoryFormat.NATIVE);

        expect(config.getTimeToLiveSeconds()).toBe(23);
        expect(config.getMaxIdleSeconds()).toBe(42);
        expect(config.isInvalidateOnChange()).toBe(true);
        expect(config.getInMemoryFormat()).toBe(InMemoryFormat.NATIVE);
    });

    it('testConstructor_withMultipleParametersAndEvictionConfig', () => {
        const evictionConfig = new EvictionConfig()
            .setEvictionPolicy(EvictionPolicy.LFU)
            .setMaxSizePolicy(MaxSizePolicy.USED_NATIVE_MEMORY_PERCENTAGE)
            .setSize(66);

        config = new NearCacheConfig();
        config.setTimeToLiveSeconds(23);
        config.setMaxIdleSeconds(42);
        config.setInvalidateOnChange(true);
        config.setInMemoryFormat(InMemoryFormat.NATIVE);
        config.setEvictionConfig(evictionConfig);

        expect(config.getTimeToLiveSeconds()).toBe(23);
        expect(config.getMaxIdleSeconds()).toBe(42);
        expect(config.isInvalidateOnChange()).toBe(true);
        expect(config.getInMemoryFormat()).toBe(InMemoryFormat.NATIVE);
        expect(config.getEvictionConfig().getEvictionPolicy()).toBe(EvictionPolicy.LFU);
        expect(config.getEvictionConfig().getMaxSizePolicy()).toBe(MaxSizePolicy.USED_NATIVE_MEMORY_PERCENTAGE);
        expect(config.getEvictionConfig().getSize()).toBe(66);
    });

    it('testSetInMemoryFormat_withString', () => {
        config.setInMemoryFormatFromString('NATIVE');
        expect(config.getInMemoryFormat()).toBe(InMemoryFormat.NATIVE);
    });

    it('testSetInMemoryFormat_withInvalidString', () => {
        expect(() => config.setInMemoryFormatFromString('UNKNOWN')).toThrow();
    });

    it('testSetInMemoryFormat_withString_whenNull', () => {
        expect(() => config.setInMemoryFormatFromString(null as unknown as string)).toThrow();
    });

    it('testIsSerializeKeys_whenEnabled', () => {
        config.setSerializeKeys(true);
        expect(config.isSerializeKeys()).toBe(true);
    });

    it('testIsSerializeKeys_whenDisabled', () => {
        config.setSerializeKeys(false);
        expect(config.isSerializeKeys()).toBe(false);
    });

    it('testIsSerializeKeys_whenNativeMemoryFormat_thenAlwaysReturnTrue', () => {
        config.setSerializeKeys(false);
        config.setInMemoryFormat(InMemoryFormat.NATIVE);
        expect(config.isSerializeKeys()).toBe(true);
    });

    it('testMaxSize_whenValueIsPositive_thenSetValue', () => {
        config.getEvictionConfig().setSize(4531);
        expect(config.getEvictionConfig().getSize()).toBe(4531);
    });

    it('testMaxSize_whenValueIsNegative_thenThrowException', () => {
        expect(() => config.getEvictionConfig().setSize(-1)).toThrow();
    });

    it('testSetEvictionConfig_whenNull_thenThrowException', () => {
        expect(() => config.setEvictionConfig(null as unknown as EvictionConfig)).toThrow();
    });

    it('testSetNearCachePreloaderConfig', () => {
        const preloaderConfig = new NearCachePreloaderConfig();
        config.setPreloaderConfig(preloaderConfig);
        expect(config.getPreloaderConfig()).toBe(preloaderConfig);
    });

    it('testSetNearCachePreloaderConfig_whenNull_thenThrowException', () => {
        expect(() => config.setPreloaderConfig(null as unknown as NearCachePreloaderConfig)).toThrow();
    });

    it('test_null_name_throws_exception', () => {
        expect(() => config.setName(null as unknown as string)).toThrow();
    });

    it('test_constructor_with_null_name_throws_exception', () => {
        expect(() => new NearCacheConfig(null as unknown as string)).toThrow();
    });
});
