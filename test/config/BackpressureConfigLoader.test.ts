/**
 * Tests for BackpressureConfig loading via parseRawConfig.
 * Block P4: Verifies that backpressure config is properly parsed from
 * both camelCase and kebab-case YAML/JSON formats.
 */
import { parseRawConfig } from '@zenystx/helios-core/config/ConfigLoader';
import { describe, expect, test } from 'bun:test';

describe('BackpressureConfig loading', () => {
    test('defaults when no backpressure section', () => {
        const config = parseRawConfig({ name: 'test' });
        const bp = config.getBackpressureConfig();
        expect(bp.isEnabled()).toBe(true);
        expect(bp.getMaxConcurrentInvocationsPerPartition()).toBe(100);
        expect(bp.getBackoffTimeoutMs()).toBe(60_000);
        expect(bp.getSyncWindow()).toBe(100);
    });

    test('parses camelCase backpressure config', () => {
        const config = parseRawConfig({
            name: 'test',
            backpressure: {
                enabled: true,
                maxConcurrentInvocationsPerPartition: 50,
                backoffTimeoutMs: 30_000,
                syncWindow: 200,
            },
        });
        const bp = config.getBackpressureConfig();
        expect(bp.isEnabled()).toBe(true);
        expect(bp.getMaxConcurrentInvocationsPerPartition()).toBe(50);
        expect(bp.getBackoffTimeoutMs()).toBe(30_000);
        expect(bp.getSyncWindow()).toBe(200);
    });

    test('parses kebab-case backpressure config', () => {
        const config = parseRawConfig({
            name: 'test',
            backpressure: {
                enabled: false,
                'max-concurrent-invocations-per-partition': 75,
                'backoff-timeout-ms': 10_000,
                'sync-window': 50,
            },
        });
        const bp = config.getBackpressureConfig();
        expect(bp.isEnabled()).toBe(false);
        expect(bp.getMaxConcurrentInvocationsPerPartition()).toBe(75);
        expect(bp.getBackoffTimeoutMs()).toBe(10_000);
        expect(bp.getSyncWindow()).toBe(50);
    });

    test('partial config preserves defaults for unset fields', () => {
        const config = parseRawConfig({
            name: 'test',
            backpressure: {
                enabled: false,
            },
        });
        const bp = config.getBackpressureConfig();
        expect(bp.isEnabled()).toBe(false);
        // Defaults preserved
        expect(bp.getMaxConcurrentInvocationsPerPartition()).toBe(100);
        expect(bp.getBackoffTimeoutMs()).toBe(60_000);
        expect(bp.getSyncWindow()).toBe(100);
    });

    test('backpressure config computes effective max for 271 partitions', () => {
        const config = parseRawConfig({
            name: 'test',
            backpressure: {
                maxConcurrentInvocationsPerPartition: 50,
            },
        });
        const bp = config.getBackpressureConfig();
        // (271 + 1) * 50 = 13600
        expect(bp.computeMaxConcurrentInvocations(271)).toBe(13_600);
    });

    test('backpressure config is accessible from HeliosConfig', () => {
        const config = parseRawConfig({ name: 'bp-test' });
        const bp = config.getBackpressureConfig();
        expect(bp).toBeDefined();
        // Mutate and verify
        bp.setEnabled(false).setMaxConcurrentInvocationsPerPartition(25);
        expect(config.getBackpressureConfig().isEnabled()).toBe(false);
        expect(config.getBackpressureConfig().getMaxConcurrentInvocationsPerPartition()).toBe(25);
    });
});
