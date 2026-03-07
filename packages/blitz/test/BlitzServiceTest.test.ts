/**
 * BlitzService integration tests — uses embedded NATS server via BlitzService.start().
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { BlitzService } from '../src/BlitzService.ts';

describe('BlitzService — NATS integration', () => {
    let embeddedBlitz: BlitzService;

    beforeAll(async () => {
        embeddedBlitz = await BlitzService.start();
    });

    afterAll(async () => {
        await embeddedBlitz.shutdown();
    });

    describe('connect / shutdown', () => {
        it('connects to NATS server', async () => {
            const blitz = await BlitzService.connect({ servers: embeddedBlitz.config.servers });
            expect(blitz).toBeDefined();
            expect(blitz.isClosed).toBe(false);
            await blitz.shutdown();
        });

        it('exposes resolved config', async () => {
            const blitz = await BlitzService.connect({ servers: embeddedBlitz.config.servers });
            expect(blitz.config.servers).toBe(embeddedBlitz.config.servers);
            expect(blitz.config.kvBucketPrefix).toBe('helios-blitz');
            await blitz.shutdown();
        });

        it('exposes JetStream client (js)', async () => {
            const blitz = await BlitzService.connect({ servers: embeddedBlitz.config.servers });
            expect(blitz.js).toBeDefined();
            await blitz.shutdown();
        });

        it('exposes JetStream manager (jsm)', async () => {
            const blitz = await BlitzService.connect({ servers: embeddedBlitz.config.servers });
            expect(blitz.jsm).toBeDefined();
            await blitz.shutdown();
        });

        it('exposes KV manager (kvm)', async () => {
            const blitz = await BlitzService.connect({ servers: embeddedBlitz.config.servers });
            expect(blitz.kvm).toBeDefined();
            await blitz.shutdown();
        });

        it('isClosed is true after shutdown', async () => {
            const blitz = await BlitzService.connect({ servers: embeddedBlitz.config.servers });
            expect(blitz.isClosed).toBe(false);
            await blitz.shutdown();
            expect(blitz.isClosed).toBe(true);
        });

        it('shutdown is idempotent (double shutdown does not throw)', async () => {
            const blitz = await BlitzService.connect({ servers: embeddedBlitz.config.servers });
            await blitz.shutdown();
            await expect(blitz.shutdown()).resolves.toBeUndefined();
        });

        it('exposes nc (NatsConnection)', async () => {
            const blitz = await BlitzService.connect({ servers: embeddedBlitz.config.servers });
            expect(blitz.nc).toBeDefined();
            await blitz.shutdown();
        });
    });

    describe('error handling', () => {
        it('throws on unreachable server', async () => {
            await expect(
                BlitzService.connect({
                    servers: 'nats://localhost:59999',
                    connectTimeoutMs: 500,
                    maxReconnectAttempts: 0,
                }),
            ).rejects.toBeDefined();
        });
    });
});
