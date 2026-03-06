import { describe, it, expect } from 'bun:test';
import { EvictionConfig } from '@zenystx/core/config/EvictionConfig';
import { EvictionPolicy } from '@zenystx/core/config/EvictionPolicy';
import { MaxSizePolicy } from '@zenystx/core/config/MaxSizePolicy';

describe('EvictionConfigTest', () => {

    it('testDefaults', () => {
        const config = new EvictionConfig();
        expect(config.getSize()).toBe(EvictionConfig.DEFAULT_MAX_ENTRY_COUNT);
        expect(config.getMaxSizePolicy()).toBe(EvictionConfig.DEFAULT_MAX_SIZE_POLICY);
        expect(config.getEvictionPolicy()).toBe(EvictionConfig.DEFAULT_EVICTION_POLICY);
    });

    it('testSetSize_positive', () => {
        expect(new EvictionConfig().setSize(1000).getSize()).toBe(1000);
    });

    it('testSetSize_zero', () => {
        expect(new EvictionConfig().setSize(0).getSize()).toBe(0);
    });

    it('testSetSize_negative_throws', () => {
        expect(() => new EvictionConfig().setSize(-1)).toThrow();
    });

    it('testSetEvictionPolicy', () => {
        expect(new EvictionConfig().setEvictionPolicy(EvictionPolicy.LFU).getEvictionPolicy()).toBe(EvictionPolicy.LFU);
    });

    it('testSetMaxSizePolicy', () => {
        expect(
            new EvictionConfig().setMaxSizePolicy(MaxSizePolicy.USED_NATIVE_MEMORY_PERCENTAGE).getMaxSizePolicy()
        ).toBe(MaxSizePolicy.USED_NATIVE_MEMORY_PERCENTAGE);
    });

});
