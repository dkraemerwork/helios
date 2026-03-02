/**
 * BlitzConfig unit tests — no NATS server required.
 *
 * Tests default value application and config validation.
 */
import { describe, it, expect } from 'bun:test';
import { resolveBlitzConfig, type BlitzConfig } from '../src/BlitzConfig.ts';

describe('BlitzConfig', () => {
    describe('resolveBlitzConfig', () => {
        it('preserves servers string', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.servers).toBe('nats://localhost:4222');
        });

        it('preserves servers array', () => {
            const cfg = resolveBlitzConfig({ servers: ['nats://a:4222', 'nats://b:4222'] });
            expect(cfg.servers).toEqual(['nats://a:4222', 'nats://b:4222']);
        });

        it('applies default kvBucketPrefix', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.kvBucketPrefix).toBe('helios-blitz');
        });

        it('preserves custom kvBucketPrefix', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222', kvBucketPrefix: 'my-prefix' });
            expect(cfg.kvBucketPrefix).toBe('my-prefix');
        });

        it('applies default streamRetention', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.streamRetention).toBe('workqueue');
        });

        it('preserves custom streamRetention', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222', streamRetention: 'limits' });
            expect(cfg.streamRetention).toBe('limits');
        });

        it('applies default streamMaxAgeMs', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.streamMaxAgeMs).toBe(0);
        });

        it('applies default connectTimeoutMs', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.connectTimeoutMs).toBe(5000);
        });

        it('applies default reconnectWaitMs', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.reconnectWaitMs).toBe(2000);
        });

        it('applies default maxReconnectAttempts', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            expect(cfg.maxReconnectAttempts).toBe(-1);
        });

        it('produces all required fields', () => {
            const cfg = resolveBlitzConfig({ servers: 'nats://localhost:4222' });
            const keys: (keyof typeof cfg)[] = [
                'servers', 'kvBucketPrefix', 'streamRetention',
                'streamMaxAgeMs', 'connectTimeoutMs', 'reconnectWaitMs', 'maxReconnectAttempts',
            ];
            for (const key of keys) {
                expect(cfg[key]).toBeDefined();
            }
        });
    });
});
