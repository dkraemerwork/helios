/**
 * Block 17.1 — ExecutorConfig + HeliosConfig Extensions
 *
 * Tests bounded defaults, fluent builder, validation, named config lookup,
 * default fallback, and unsupported split-brain rejection.
 */
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { describe, expect, test } from 'bun:test';

describe('ExecutorConfig', () => {

    test('defaults are bounded and non-zero', () => {
        const cfg = new ExecutorConfig('compute');
        expect(cfg.getName()).toBe('compute');
        expect(cfg.getPoolSize()).toBeGreaterThan(0);
        expect(cfg.getPoolSize()).toBeLessThanOrEqual(16);
        expect(cfg.getQueueCapacity()).toBe(1024);
        expect(cfg.getMaxActiveTaskTypePools()).toBe(32);
        expect(cfg.getPoolIdleMillis()).toBe(300_000);
        expect(cfg.getTaskTimeoutMillis()).toBe(300_000);
        expect(cfg.getShutdownTimeoutMillis()).toBe(10_000);
        expect(cfg.isStatisticsEnabled()).toBe(true);
        expect(cfg.getSplitBrainProtectionName()).toBeNull();
    });

    test('fluent builder/getters round-trip', () => {
        const cfg = new ExecutorConfig('my-exec')
            .setPoolSize(4)
            .setQueueCapacity(512)
            .setMaxActiveTaskTypePools(8)
            .setPoolIdleMillis(60_000)
            .setTaskTimeoutMillis(120_000)
            .setShutdownTimeoutMillis(5_000)
            .setStatisticsEnabled(false);

        expect(cfg.getName()).toBe('my-exec');
        expect(cfg.getPoolSize()).toBe(4);
        expect(cfg.getQueueCapacity()).toBe(512);
        expect(cfg.getMaxActiveTaskTypePools()).toBe(8);
        expect(cfg.getPoolIdleMillis()).toBe(60_000);
        expect(cfg.getTaskTimeoutMillis()).toBe(120_000);
        expect(cfg.getShutdownTimeoutMillis()).toBe(5_000);
        expect(cfg.isStatisticsEnabled()).toBe(false);
    });

    test('invalid negative/zero poolSize throws', () => {
        expect(() => new ExecutorConfig('x').setPoolSize(0)).toThrow();
        expect(() => new ExecutorConfig('x').setPoolSize(-1)).toThrow();
    });

    test('invalid negative/zero queueCapacity throws', () => {
        expect(() => new ExecutorConfig('x').setQueueCapacity(0)).toThrow();
        expect(() => new ExecutorConfig('x').setQueueCapacity(-5)).toThrow();
    });

    test('invalid maxActiveTaskTypePools throws', () => {
        expect(() => new ExecutorConfig('x').setMaxActiveTaskTypePools(0)).toThrow();
        expect(() => new ExecutorConfig('x').setMaxActiveTaskTypePools(-1)).toThrow();
    });

    test('negative taskTimeoutMillis throws', () => {
        expect(() => new ExecutorConfig('x').setTaskTimeoutMillis(-1)).toThrow();
        // zero is valid (means no timeout)
        expect(new ExecutorConfig('x').setTaskTimeoutMillis(0).getTaskTimeoutMillis()).toBe(0);
    });

    test('invalid shutdownTimeoutMillis throws', () => {
        expect(() => new ExecutorConfig('x').setShutdownTimeoutMillis(0)).toThrow();
        expect(() => new ExecutorConfig('x').setShutdownTimeoutMillis(-1)).toThrow();
    });

    test('unsupported splitBrainProtectionName fails fast', () => {
        expect(() => new ExecutorConfig('x').setSplitBrainProtectionName('my-quorum')).toThrow(
            /split.?brain.*not.*supported|unsupported/i,
        );
    });
});

describe('HeliosConfig executor extensions', () => {

    test('named executor config lookup works', () => {
        const hc = new HeliosConfig();
        const ec = new ExecutorConfig('compute').setPoolSize(8);
        hc.addExecutorConfig(ec);

        const found = hc.getExecutorConfig('compute');
        expect(found).not.toBeNull();
        expect(found!.getPoolSize()).toBe(8);
    });

    test('unknown executor falls back to default config', () => {
        const hc = new HeliosConfig();
        const fallback = hc.getExecutorConfig('nonexistent');
        expect(fallback).not.toBeNull();
        expect(fallback!.getName()).toBe('nonexistent');
        // Should have defaults
        expect(fallback!.getQueueCapacity()).toBe(1024);
    });

    test('getExecutorConfigs() returns all registered configs', () => {
        const hc = new HeliosConfig();
        hc.addExecutorConfig(new ExecutorConfig('a'));
        hc.addExecutorConfig(new ExecutorConfig('b'));

        const all = hc.getExecutorConfigs();
        expect(all.size).toBe(2);
        expect(all.has('a')).toBe(true);
        expect(all.has('b')).toBe(true);
    });
});
