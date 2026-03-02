/**
 * BlitzService integration tests — requires a running NATS server with JetStream.
 *
 * Skip guard: tests are skipped unless NATS_URL or CI env var is set.
 * In CI: NATS_URL=nats://localhost:4222
 * Locally: set NATS_URL to point at a running nats-server -js
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { BlitzService } from '../src/BlitzService.ts';

const NATS_AVAILABLE = !!process.env['NATS_URL'] || !!process.env['CI'];
const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';

describe.skipIf(!NATS_AVAILABLE)('BlitzService — NATS integration', () => {
    let natsServer: ReturnType<typeof Bun.spawn> | null = null;

    beforeAll(async () => {
        if (!process.env['NATS_URL']) {
            // CI=true but no explicit NATS_URL — spawn a local server
            natsServer = Bun.spawn(
                [require.resolve('nats-server/bin/nats-server'), '-js', '-p', '4222'],
                { stdout: 'ignore', stderr: 'ignore' },
            );
            // Health-poll: wait until NATS accepts connections (up to 3s)
            const { connect } = await import('@nats-io/transport-node');
            for (let i = 0; i < 30; i++) {
                try {
                    const nc = await connect({ servers: 'nats://localhost:4222', timeout: 500 });
                    await nc.close();
                    break;
                } catch {
                    await Bun.sleep(100);
                }
            }
        }
    });

    afterAll(() => {
        natsServer?.kill();
    });

    describe('connect / shutdown', () => {
        it('connects to NATS server', async () => {
            const blitz = await BlitzService.connect({ servers: NATS_URL });
            expect(blitz).toBeDefined();
            expect(blitz.isClosed).toBe(false);
            await blitz.shutdown();
        });

        it('exposes resolved config', async () => {
            const blitz = await BlitzService.connect({ servers: NATS_URL });
            expect(blitz.config.servers).toBe(NATS_URL);
            expect(blitz.config.kvBucketPrefix).toBe('helios-blitz');
            await blitz.shutdown();
        });

        it('exposes JetStream client (js)', async () => {
            const blitz = await BlitzService.connect({ servers: NATS_URL });
            expect(blitz.js).toBeDefined();
            await blitz.shutdown();
        });

        it('exposes JetStream manager (jsm)', async () => {
            const blitz = await BlitzService.connect({ servers: NATS_URL });
            expect(blitz.jsm).toBeDefined();
            await blitz.shutdown();
        });

        it('exposes KV manager (kvm)', async () => {
            const blitz = await BlitzService.connect({ servers: NATS_URL });
            expect(blitz.kvm).toBeDefined();
            await blitz.shutdown();
        });

        it('isClosed is true after shutdown', async () => {
            const blitz = await BlitzService.connect({ servers: NATS_URL });
            expect(blitz.isClosed).toBe(false);
            await blitz.shutdown();
            expect(blitz.isClosed).toBe(true);
        });

        it('shutdown is idempotent (double shutdown does not throw)', async () => {
            const blitz = await BlitzService.connect({ servers: NATS_URL });
            await blitz.shutdown();
            await expect(blitz.shutdown()).resolves.toBeUndefined();
        });

        it('exposes nc (NatsConnection)', async () => {
            const blitz = await BlitzService.connect({ servers: NATS_URL });
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
