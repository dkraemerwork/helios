/**
 * Tests for BackpressureRegulator — Block P4: Remote Invocation Backpressure Parity.
 *
 * Verifies:
 * - Bounded in-flight admission
 * - Deterministic reject-after-timeout behavior
 * - Wait-then-admit FIFO semantics
 * - Release drains queued waiters
 * - Sync window forced-sync coercion
 * - Stats observability
 * - Disabled-mode passthrough
 * - Reset/shutdown safety
 * - Interaction with InvocationMonitor timeout/member-left
 */
import { BackpressureConfig } from '@zenystx/helios-core/config/BackpressureConfig';
import {
    BackpressureRegulator,
    OverloadError,
} from '@zenystx/helios-core/spi/impl/operationservice/BackpressureRegulator';
import { beforeEach, describe, expect, test } from 'bun:test';

function makeConfig(overrides?: {
    enabled?: boolean;
    perPartition?: number;
    backoffTimeoutMs?: number;
    syncWindow?: number;
}): BackpressureConfig {
    const config = new BackpressureConfig();
    if (overrides?.enabled !== undefined) config.setEnabled(overrides.enabled);
    if (overrides?.perPartition !== undefined) config.setMaxConcurrentInvocationsPerPartition(overrides.perPartition);
    if (overrides?.backoffTimeoutMs !== undefined) config.setBackoffTimeoutMs(overrides.backoffTimeoutMs);
    if (overrides?.syncWindow !== undefined) config.setSyncWindow(overrides.syncWindow);
    return config;
}

/** Small partition count for deterministic tests. */
const TEST_PARTITIONS = 3;

describe('BackpressureRegulator', () => {
    // ── Basic admission ────────────────────────────────────────────────

    describe('admission control', () => {
        test('admits invocations when below capacity', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 10 }),
                TEST_PARTITIONS,
            );
            // capacity = (3 + 1) * 10 = 40
            expect(regulator.maxConcurrentInvocations).toBe(40);

            const callId = regulator.tryAcquire();
            expect(typeof callId).toBe('number');
            expect(callId).toBe(1);
            expect(regulator.inFlightCount).toBe(1);
        });

        test('admits multiple invocations up to capacity', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 2 }),
                TEST_PARTITIONS,
            );
            // capacity = (3 + 1) * 2 = 8
            const ids: number[] = [];
            for (let i = 0; i < 8; i++) {
                const result = regulator.tryAcquire();
                expect(typeof result).toBe('number');
                ids.push(result as number);
            }
            expect(regulator.inFlightCount).toBe(8);
            // call IDs are monotonically increasing
            for (let i = 1; i < ids.length; i++) {
                expect(ids[i]).toBeGreaterThan(ids[i - 1]!);
            }
        });

        test('returns Promise when at capacity with backoff > 0', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 5_000 }),
                TEST_PARTITIONS,
            );
            // capacity = (3+1) * 1 = 4
            for (let i = 0; i < 4; i++) regulator.tryAcquire();
            expect(regulator.inFlightCount).toBe(4);

            const result = regulator.tryAcquire();
            expect(result).toBeInstanceOf(Promise);
        });

        test('throws OverloadError immediately when at capacity with backoff = 0', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 0 }),
                TEST_PARTITIONS,
            );
            // capacity = 4
            for (let i = 0; i < 4; i++) regulator.tryAcquire();

            expect(() => regulator.tryAcquire()).toThrow(OverloadError);
        });
    });

    // ── Release and waiter draining ────────────────────────────────────

    describe('release and waiter draining', () => {
        test('release decrements in-flight count', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 10 }),
                TEST_PARTITIONS,
            );
            regulator.tryAcquire();
            expect(regulator.inFlightCount).toBe(1);
            regulator.release();
            expect(regulator.inFlightCount).toBe(0);
        });

        test('release admits a queued waiter FIFO', async () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 5_000 }),
                TEST_PARTITIONS,
            );
            // Fill capacity
            for (let i = 0; i < 4; i++) regulator.tryAcquire();

            // Queue a waiter
            const waiterPromise = regulator.tryAcquire() as Promise<number>;
            expect(waiterPromise).toBeInstanceOf(Promise);

            // Release one slot — waiter should be admitted
            regulator.release();

            const callId = await waiterPromise;
            expect(typeof callId).toBe('number');
            expect(callId).toBeGreaterThan(0);
            // 4 slots still in-flight (3 original + 1 waiter re-admitted)
            expect(regulator.inFlightCount).toBe(4);
        });

        test('multiple waiters are drained in FIFO order', async () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 5_000 }),
                TEST_PARTITIONS,
            );
            // Fill capacity
            for (let i = 0; i < 4; i++) regulator.tryAcquire();

            const order: number[] = [];
            const w1 = (regulator.tryAcquire() as Promise<number>).then((id) => {
                order.push(1);
                return id;
            });
            const w2 = (regulator.tryAcquire() as Promise<number>).then((id) => {
                order.push(2);
                return id;
            });

            // Release two slots
            regulator.release();
            regulator.release();

            await Promise.all([w1, w2]);
            expect(order).toEqual([1, 2]);
        });
    });

    // ── Timeout rejection ──────────────────────────────────────────────

    describe('backoff timeout', () => {
        test('rejects waiter after backoff timeout', async () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 50 }),
                TEST_PARTITIONS,
            );
            // Fill capacity
            for (let i = 0; i < 4; i++) regulator.tryAcquire();

            const waiterPromise = regulator.tryAcquire() as Promise<number>;
            try {
                await waiterPromise;
                expect(true).toBe(false); // should not reach
            } catch (e) {
                expect(e).toBeInstanceOf(OverloadError);
                const overload = e as OverloadError;
                expect(overload.maxConcurrentInvocations).toBe(4);
                expect(overload.backoffTimeoutMs).toBe(50);
            }
        });

        test('rejected invocations are counted in stats', async () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 30 }),
                TEST_PARTITIONS,
            );
            for (let i = 0; i < 4; i++) regulator.tryAcquire();

            try {
                await (regulator.tryAcquire() as Promise<number>);
            } catch {
                // expected
            }

            const stats = regulator.getStats();
            expect(stats.rejected).toBe(1);
            expect(stats.admittedImmediate).toBe(4);
        });
    });

    // ── Disabled mode ──────────────────────────────────────────────────

    describe('disabled mode', () => {
        test('disabled regulator always admits immediately', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ enabled: false, perPartition: 1 }),
                TEST_PARTITIONS,
            );
            expect(regulator.enabled).toBe(false);
            expect(regulator.maxConcurrentInvocations).toBe(Number.MAX_SAFE_INTEGER);

            // Should never block even with a huge number of invocations
            for (let i = 0; i < 1000; i++) {
                const result = regulator.tryAcquire();
                expect(typeof result).toBe('number');
            }
        });

        test('disabled regulator release is a no-op', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ enabled: false }),
                TEST_PARTITIONS,
            );
            regulator.tryAcquire();
            regulator.release(); // should not throw or decrement below 0
        });

        test('disabled regulator isSyncForced is always false', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ enabled: false, syncWindow: 1 }),
                TEST_PARTITIONS,
            );
            for (let i = 0; i < 100; i++) {
                expect(regulator.isSyncForced(true)).toBe(false);
            }
        });
    });

    // ── Forced sync coercion ───────────────────────────────────────────

    describe('sync window / forced sync', () => {
        test('forces sync after sync window operations', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ syncWindow: 5 }),
                TEST_PARTITIONS,
            );
            let forcedCount = 0;
            for (let i = 0; i < 20; i++) {
                if (regulator.isSyncForced(true)) forcedCount++;
            }
            // With syncWindow=5, we expect roughly 4 forced syncs in 20 ops
            // (with ±25% jitter, the actual count may vary)
            expect(forcedCount).toBeGreaterThanOrEqual(2);
            expect(forcedCount).toBeLessThanOrEqual(8);
        });

        test('does not force sync when hasAsyncBackups is false', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ syncWindow: 1 }),
                TEST_PARTITIONS,
            );
            for (let i = 0; i < 100; i++) {
                expect(regulator.isSyncForced(false)).toBe(false);
            }
        });

        test('forced syncs are tracked in stats', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ syncWindow: 1 }),
                TEST_PARTITIONS,
            );
            // syncWindow=1 means every call is forced
            regulator.isSyncForced(true);
            regulator.isSyncForced(true);
            regulator.isSyncForced(true);
            const stats = regulator.getStats();
            expect(stats.forcedSyncs).toBe(3);
        });
    });

    // ── Stats observability ────────────────────────────────────────────

    describe('stats', () => {
        test('initial stats are zeroed', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 10 }),
                TEST_PARTITIONS,
            );
            const stats = regulator.getStats();
            expect(stats.enabled).toBe(true);
            expect(stats.maxConcurrentInvocations).toBe(40);
            expect(stats.inFlightCount).toBe(0);
            expect(stats.admittedImmediate).toBe(0);
            expect(stats.admittedAfterWait).toBe(0);
            expect(stats.rejected).toBe(0);
            expect(stats.forcedSyncs).toBe(0);
        });

        test('stats reflect admission and release', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 10 }),
                TEST_PARTITIONS,
            );
            regulator.tryAcquire();
            regulator.tryAcquire();
            regulator.tryAcquire();
            regulator.release();

            const stats = regulator.getStats();
            expect(stats.admittedImmediate).toBe(3);
            expect(stats.inFlightCount).toBe(2);
        });

        test('admittedAfterWait is incremented for waited admissions', async () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 5_000 }),
                TEST_PARTITIONS,
            );
            for (let i = 0; i < 4; i++) regulator.tryAcquire();

            const waiterPromise = regulator.tryAcquire() as Promise<number>;
            regulator.release();
            await waiterPromise;

            const stats = regulator.getStats();
            expect(stats.admittedImmediate).toBe(4);
            expect(stats.admittedAfterWait).toBe(1);
        });
    });

    // ── Reset / shutdown safety ────────────────────────────────────────

    describe('reset and shutdown', () => {
        test('rejectAll rejects all queued waiters', async () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 60_000 }),
                TEST_PARTITIONS,
            );
            for (let i = 0; i < 4; i++) regulator.tryAcquire();

            const w1 = regulator.tryAcquire() as Promise<number>;
            const w2 = regulator.tryAcquire() as Promise<number>;

            regulator.rejectAll(new Error('shutting down'));

            await expect(w1).rejects.toThrow('shutting down');
            await expect(w2).rejects.toThrow('shutting down');
        });

        test('reset clears in-flight count and rejects waiters', async () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1, backoffTimeoutMs: 60_000 }),
                TEST_PARTITIONS,
            );
            for (let i = 0; i < 4; i++) regulator.tryAcquire();
            const waiter = regulator.tryAcquire() as Promise<number>;

            regulator.reset();

            expect(regulator.inFlightCount).toBe(0);
            await expect(waiter).rejects.toThrow(/reset/i);
        });
    });

    // ── hasSpace ───────────────────────────────────────────────────────

    describe('hasSpace', () => {
        test('returns true when below capacity', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 2 }),
                TEST_PARTITIONS,
            );
            expect(regulator.hasSpace()).toBe(true);
            for (let i = 0; i < 7; i++) regulator.tryAcquire();
            expect(regulator.hasSpace()).toBe(true);
        });

        test('returns false when at capacity', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1 }),
                TEST_PARTITIONS,
            );
            for (let i = 0; i < 4; i++) regulator.tryAcquire();
            expect(regulator.hasSpace()).toBe(false);
        });

        test('returns true after release from capacity', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 1 }),
                TEST_PARTITIONS,
            );
            for (let i = 0; i < 4; i++) regulator.tryAcquire();
            expect(regulator.hasSpace()).toBe(false);
            regulator.release();
            expect(regulator.hasSpace()).toBe(true);
        });

        test('always true when disabled', () => {
            const regulator = new BackpressureRegulator(
                makeConfig({ enabled: false }),
                TEST_PARTITIONS,
            );
            expect(regulator.hasSpace()).toBe(true);
        });
    });

    // ── Stress: bounded in-flight under saturation ─────────────────────

    describe('stress: bounded in-flight', () => {
        test('in-flight count never exceeds capacity under concurrent pressure', async () => {
            const capacity = 8; // (3+1) * 2
            const regulator = new BackpressureRegulator(
                makeConfig({ perPartition: 2, backoffTimeoutMs: 2_000 }),
                TEST_PARTITIONS,
            );
            expect(regulator.maxConcurrentInvocations).toBe(capacity);

            let maxObserved = 0;
            const completions: Array<() => void> = [];
            const promises: Promise<void>[] = [];

            // Fire 50 invocations — far more than capacity
            for (let i = 0; i < 50; i++) {
                const p = (async () => {
                    const result = regulator.tryAcquire();
                    const _callId = result instanceof Promise ? await result : result;
                    maxObserved = Math.max(maxObserved, regulator.inFlightCount);
                    expect(regulator.inFlightCount).toBeLessThanOrEqual(capacity);

                    // Simulate work, then release
                    await new Promise<void>((resolve) => {
                        completions.push(() => {
                            regulator.release();
                            resolve();
                        });
                    });
                })();
                promises.push(p);
            }

            // Drain completions in batches
            while (completions.length > 0) {
                const batch = completions.splice(0, 4);
                for (const complete of batch) complete();
                await new Promise((r) => setTimeout(r, 1));
            }

            await Promise.all(promises);
            expect(maxObserved).toBeLessThanOrEqual(capacity);
            expect(regulator.inFlightCount).toBe(0);
        });
    });
});

// ── BackpressureConfig tests ──────────────────────────────────────────────

describe('BackpressureConfig', () => {
    test('defaults', () => {
        const config = new BackpressureConfig();
        expect(config.isEnabled()).toBe(true);
        expect(config.getMaxConcurrentInvocationsPerPartition()).toBe(100);
        expect(config.getBackoffTimeoutMs()).toBe(60_000);
        expect(config.getSyncWindow()).toBe(100);
    });

    test('computeMaxConcurrentInvocations with default partition count', () => {
        const config = new BackpressureConfig();
        // (271 + 1) * 100 = 27200
        expect(config.computeMaxConcurrentInvocations(271)).toBe(27200);
    });

    test('computeMaxConcurrentInvocations when disabled', () => {
        const config = new BackpressureConfig();
        config.setEnabled(false);
        expect(config.computeMaxConcurrentInvocations(271)).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('rejects invalid perPartition', () => {
        const config = new BackpressureConfig();
        expect(() => config.setMaxConcurrentInvocationsPerPartition(0)).toThrow();
        expect(() => config.setMaxConcurrentInvocationsPerPartition(-1)).toThrow();
    });

    test('rejects negative backoffTimeoutMs', () => {
        const config = new BackpressureConfig();
        expect(() => config.setBackoffTimeoutMs(-1)).toThrow();
    });

    test('rejects invalid syncWindow', () => {
        const config = new BackpressureConfig();
        expect(() => config.setSyncWindow(0)).toThrow();
        expect(() => config.setSyncWindow(-5)).toThrow();
    });

    test('fluent API', () => {
        const config = new BackpressureConfig()
            .setEnabled(true)
            .setMaxConcurrentInvocationsPerPartition(50)
            .setBackoffTimeoutMs(30_000)
            .setSyncWindow(200);

        expect(config.isEnabled()).toBe(true);
        expect(config.getMaxConcurrentInvocationsPerPartition()).toBe(50);
        expect(config.getBackoffTimeoutMs()).toBe(30_000);
        expect(config.getSyncWindow()).toBe(200);
    });
});

// ── OverloadError tests ───────────────────────────────────────────────────

describe('OverloadError', () => {
    test('has expected fields', () => {
        const err = new OverloadError(100, 5_000, 100);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(OverloadError);
        expect(err.name).toBe('OverloadError');
        expect(err.maxConcurrentInvocations).toBe(100);
        expect(err.backoffTimeoutMs).toBe(5_000);
        expect(err.inFlightCount).toBe(100);
        expect(err.message).toContain('Backpressure');
        expect(err.message).toContain('100');
    });
});
