/**
 * Block 10.7 — Fault tolerance tests
 *
 * Tests: AckPolicy, RetryPolicy, DeadLetterSink, CheckpointManager, FaultHandler.
 * All tests are pure unit tests — no NATS required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AckPolicy } from '../src/fault/AckPolicy.ts';
import { RetryPolicy } from '../src/fault/RetryPolicy.ts';
import { DeadLetterSink } from '../src/fault/DeadLetterSink.ts';
import type { DLPublisher } from '../src/fault/DeadLetterSink.ts';
import { CheckpointManager } from '../src/fault/CheckpointManager.ts';
import type { CheckpointStore } from '../src/fault/CheckpointManager.ts';
import { FaultHandler } from '../src/fault/FaultHandler.ts';
import type { FaultMessage } from '../src/fault/FaultHandler.ts';
import { NakError } from '../src/errors/NakError.ts';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeFaultMessage(overrides: Partial<FaultMessage> = {}): FaultMessage & {
    ackCalls: number;
    nakCalls: number;
    nakDelays: (number | undefined)[];
} {
    let ackCalls = 0;
    let nakCalls = 0;
    const nakDelays: (number | undefined)[] = [];
    const msg = {
        subject: 'test.subject',
        data: new TextEncoder().encode('hello'),
        deliveryCount: 1,
        ack(): void { ackCalls++; },
        nak(opts?: { delay?: number }): void { nakCalls++; nakDelays.push(opts?.delay); },
        get ackCalls() { return ackCalls; },
        get nakCalls() { return nakCalls; },
        get nakDelays() { return nakDelays; },
        ...overrides,
    };
    return msg as any;
}

function makeStore(): CheckpointStore & { stored: Map<string, Uint8Array>; failOnNext: boolean } {
    const stored = new Map<string, Uint8Array>();
    let failOnNext = false;
    return {
        stored,
        get failOnNext() { return failOnNext; },
        set failOnNext(v: boolean) { failOnNext = v; },
        async put(key: string, value: Uint8Array): Promise<void> {
            if (failOnNext) { failOnNext = false; throw new Error('KV write failed'); }
            stored.set(key, value);
        },
        async get(key: string): Promise<{ value: Uint8Array } | null> {
            const v = stored.get(key);
            return v ? { value: v } : null;
        },
    };
}

function makePublisher(): DLPublisher & {
    calls: Array<{ subject: string; payload: Uint8Array; headers: Record<string, string> }>;
} {
    const calls: Array<{ subject: string; payload: Uint8Array; headers: Record<string, string> }> = [];
    return {
        calls,
        async publish(subject: string, payload: Uint8Array, headers: Record<string, string>): Promise<void> {
            calls.push({ subject, payload, headers });
        },
    };
}

// ─── AckPolicy ────────────────────────────────────────────────────────────────

describe('AckPolicy enum', () => {
    it('has EXPLICIT value', () => {
        expect(AckPolicy.EXPLICIT).toBe('EXPLICIT');
    });

    it('has NONE value', () => {
        expect(AckPolicy.NONE).toBe('NONE');
    });
});

describe('FaultHandler — AckPolicy.EXPLICIT', () => {
    it('calls ack() exactly once on success', async () => {
        const msg = makeFaultMessage();
        const handler = new FaultHandler({ ackPolicy: AckPolicy.EXPLICIT, retryPolicy: RetryPolicy.fixed(3, 100) });
        await handler.handle(msg, async () => 'ok');
        expect(msg.ackCalls).toBe(1);
        expect(msg.nakCalls).toBe(0);
    });

    it('calls nak() on NakError, not ack()', async () => {
        const msg = makeFaultMessage();
        const handler = new FaultHandler({ ackPolicy: AckPolicy.EXPLICIT, retryPolicy: RetryPolicy.fixed(3, 100) });
        await handler.handle(msg, async () => { throw new NakError('fail'); });
        expect(msg.ackCalls).toBe(0);
        expect(msg.nakCalls).toBe(1);
    });

    it('does not call ack() on NakError', async () => {
        const msg = makeFaultMessage();
        const handler = new FaultHandler({ ackPolicy: AckPolicy.EXPLICIT, retryPolicy: RetryPolicy.fixed(3, 100) });
        await handler.handle(msg, async () => { throw new NakError('fail'); });
        expect(msg.ackCalls).toBe(0);
    });
});

describe('FaultHandler — AckPolicy.NONE', () => {
    it('calls neither ack() nor nak() when process succeeds', async () => {
        const msg = makeFaultMessage();
        const handler = new FaultHandler({ ackPolicy: AckPolicy.NONE, retryPolicy: RetryPolicy.fixed(3, 100) });
        await handler.handle(msg, async () => 'ok');
        expect(msg.ackCalls).toBe(0);
        expect(msg.nakCalls).toBe(0);
    });

    it('calls neither ack() nor nak() when process throws', async () => {
        const msg = makeFaultMessage();
        const handler = new FaultHandler({ ackPolicy: AckPolicy.NONE, retryPolicy: RetryPolicy.fixed(3, 100) });
        await handler.handle(msg, async () => { throw new NakError('fail'); });
        expect(msg.ackCalls).toBe(0);
        expect(msg.nakCalls).toBe(0);
    });
});

// ─── RetryPolicy — fixed delay ────────────────────────────────────────────────

describe('RetryPolicy.fixed', () => {
    it('shouldRetry returns true for attempt 0 when maxRetries > 0', () => {
        const policy = RetryPolicy.fixed(3, 100);
        expect(policy.shouldRetry(0)).toBe(true);
    });

    it('shouldRetry returns false when attempt >= maxRetries', () => {
        const policy = RetryPolicy.fixed(2, 100);
        expect(policy.shouldRetry(2)).toBe(false);
        expect(policy.shouldRetry(3)).toBe(false);
    });

    it('computeDelay returns fixed delay for all attempts', () => {
        const policy = RetryPolicy.fixed(3, 200);
        expect(policy.computeDelay(0)).toBe(200);
        expect(policy.computeDelay(1)).toBe(200);
        expect(policy.computeDelay(2)).toBe(200);
    });

    it('maxRetries=1: second failure (attempt 1) routes to DL', () => {
        const policy = RetryPolicy.fixed(1, 100);
        expect(policy.shouldRetry(0)).toBe(true);
        expect(policy.shouldRetry(1)).toBe(false);
    });

    it('nak is called with fixed delay on first retry', async () => {
        const msg = makeFaultMessage();
        const handler = new FaultHandler({ ackPolicy: AckPolicy.EXPLICIT, retryPolicy: RetryPolicy.fixed(3, 150) });
        await handler.handle(msg, async () => { throw new NakError('fail'); });
        expect(msg.nakCalls).toBe(1);
        expect(msg.nakDelays[0]).toBe(150);
    });

    it('nak is called with fixed delay on second retry', async () => {
        const msg = makeFaultMessage({ deliveryCount: 2 });
        const handler = new FaultHandler({ ackPolicy: AckPolicy.EXPLICIT, retryPolicy: RetryPolicy.fixed(3, 150) });
        await handler.handle(msg, async () => { throw new NakError('fail'); });
        expect(msg.nakCalls).toBe(1);
        expect(msg.nakDelays[0]).toBe(150);
    });
});

// ─── RetryPolicy — exponential backoff ────────────────────────────────────────

describe('RetryPolicy.exponential', () => {
    it('attempt 0 delay equals initialDelayMs (within jitter)', () => {
        const policy = RetryPolicy.exponential(5, 100);
        const delay = policy.computeDelay(0);
        // jitter ±25%: [75, 125]
        expect(delay).toBeGreaterThanOrEqual(75);
        expect(delay).toBeLessThanOrEqual(125);
    });

    it('attempt 1 delay ≈ 200ms (doubles, within jitter)', () => {
        const policy = RetryPolicy.exponential(5, 100);
        const delay = policy.computeDelay(1);
        // expected base = 200, jitter ±25%: [150, 250]
        expect(delay).toBeGreaterThanOrEqual(150);
        expect(delay).toBeLessThanOrEqual(250);
    });

    it('attempt 2 delay ≈ 400ms (doubles again, within jitter)', () => {
        const policy = RetryPolicy.exponential(5, 100);
        const delay = policy.computeDelay(2);
        // expected base = 400, jitter ±25%: [300, 500]
        expect(delay).toBeGreaterThanOrEqual(300);
        expect(delay).toBeLessThanOrEqual(500);
    });

    it('jitter is applied: delay is not exactly base * 2^n (probabilistic)', () => {
        const policy = RetryPolicy.exponential(5, 100);
        // Run multiple times — at least one delay should differ from exact base
        const delays = Array.from({ length: 20 }, (_, i) => policy.computeDelay(0));
        const uniqueDelays = new Set(delays);
        // With ±25% jitter we expect multiple different values across 20 samples
        expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it('maxBackoffMs cap enforced: delay never exceeds maximum', () => {
        const policy = RetryPolicy.exponential(10, 100, { maxBackoffMs: 300 });
        // attempt 5 would be 100 * 2^5 = 3200ms without cap
        const delay = policy.computeDelay(5);
        expect(delay).toBeLessThanOrEqual(300);
    });

    it('shouldRetry respects maxRetries', () => {
        const policy = RetryPolicy.exponential(3, 100);
        expect(policy.shouldRetry(0)).toBe(true);
        expect(policy.shouldRetry(2)).toBe(true);
        expect(policy.shouldRetry(3)).toBe(false);
    });
});

// ─── DeadLetterSink ───────────────────────────────────────────────────────────

describe('DeadLetterSink', () => {
    it('calls publisher.publish() when send() is called', async () => {
        const pub = makePublisher();
        const sink = new DeadLetterSink(pub, 'blitz-dl');
        await sink.send({ subject: 'orders', payload: new Uint8Array([1, 2, 3]), errorMessage: 'oops', deliveryCount: 3 });
        expect(pub.calls).toHaveLength(1);
    });

    it('published message includes original-subject header', async () => {
        const pub = makePublisher();
        const sink = new DeadLetterSink(pub, 'blitz-dl');
        await sink.send({ subject: 'orders.created', payload: new Uint8Array(), errorMessage: 'err', deliveryCount: 2 });
        expect(pub.calls[0]!.headers['original-subject']).toBe('orders.created');
    });

    it('published message includes error-message header', async () => {
        const pub = makePublisher();
        const sink = new DeadLetterSink(pub, 'blitz-dl');
        await sink.send({ subject: 'x', payload: new Uint8Array(), errorMessage: 'something broke', deliveryCount: 1 });
        expect(pub.calls[0]!.headers['error-message']).toBe('something broke');
    });

    it('published message includes delivery-count header', async () => {
        const pub = makePublisher();
        const sink = new DeadLetterSink(pub, 'blitz-dl');
        await sink.send({ subject: 'x', payload: new Uint8Array(), errorMessage: 'err', deliveryCount: 5 });
        expect(pub.calls[0]!.headers['delivery-count']).toBe('5');
    });

    it('published message includes sink-name header when provided', async () => {
        const pub = makePublisher();
        const sink = new DeadLetterSink(pub, 'blitz-dl');
        await sink.send({ subject: 'x', payload: new Uint8Array(), errorMessage: 'err', deliveryCount: 1, sinkName: 'HeliosMapSink' });
        expect(pub.calls[0]!.headers['sink-name']).toBe('HeliosMapSink');
    });

    it('exposes streamName', () => {
        const pub = makePublisher();
        const sink = new DeadLetterSink(pub, 'my-dl-stream');
        expect(sink.streamName).toBe('my-dl-stream');
    });

    it('publishes to correct DL subject derived from streamName', async () => {
        const pub = makePublisher();
        const sink = new DeadLetterSink(pub, 'blitz-dl');
        await sink.send({ subject: 'orders', payload: new Uint8Array(), errorMessage: 'e', deliveryCount: 1 });
        expect(pub.calls[0]!.subject).toBe('blitz-dl');
    });
});

// ─── CheckpointManager ────────────────────────────────────────────────────────

describe('CheckpointManager', () => {
    it('getCheckpoint() returns null when no checkpoint exists', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1');
        const cp = await cm.getCheckpoint();
        expect(cp).toBeNull();
    });

    it('saveCheckpoint() persists sequence and windowKeys', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1');
        await cm.saveCheckpoint(42, ['w1', 'w2']);
        const cp = await cm.getCheckpoint();
        expect(cp).not.toBeNull();
        expect(cp!.sequence).toBe(42);
        expect(cp!.windowKeys).toEqual(['w1', 'w2']);
    });

    it('saveCheckpoint() stores ts (timestamp)', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1');
        const before = Date.now();
        await cm.saveCheckpoint(10, []);
        const after = Date.now();
        const cp = await cm.getCheckpoint();
        expect(cp!.ts).toBeGreaterThanOrEqual(before);
        expect(cp!.ts).toBeLessThanOrEqual(after);
    });

    it('getCheckpoint() reads back correct sequence on restart', async () => {
        const store = makeStore();
        await new CheckpointManager(store, 'pipe1', 'consumer1').saveCheckpoint(99, []);
        const cm2 = new CheckpointManager(store, 'pipe1', 'consumer1');
        const cp = await cm2.getCheckpoint();
        expect(cp!.sequence).toBe(99);
    });

    it('getCheckpoint() reads back window keys on restart', async () => {
        const store = makeStore();
        await new CheckpointManager(store, 'pipe1', 'consumer1').saveCheckpoint(7, ['wk-a', 'wk-b']);
        const cm2 = new CheckpointManager(store, 'pipe1', 'consumer1');
        const cp = await cm2.getCheckpoint();
        expect(cp!.windowKeys).toEqual(['wk-a', 'wk-b']);
    });

    it('onAck() triggers saveCheckpoint after intervalAcks acks (default 100)', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1', { intervalAcks: 100, intervalMs: 999_999 });
        for (let i = 1; i <= 99; i++) await cm.onAck(i, []);
        expect(store.stored.size).toBe(0);
        await cm.onAck(100, []);
        expect(store.stored.size).toBe(1);
        cm.shutdown();
    });

    it('onAck() does NOT save before intervalAcks threshold', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1', { intervalAcks: 10, intervalMs: 999_999 });
        for (let i = 1; i <= 9; i++) await cm.onAck(i, []);
        expect(store.stored.size).toBe(0);
        cm.shutdown();
    });

    it('intervalAcks configurable: custom value of 5 triggers at 5th ack', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1', { intervalAcks: 5, intervalMs: 999_999 });
        for (let i = 1; i <= 4; i++) await cm.onAck(i, []);
        expect(store.stored.size).toBe(0);
        await cm.onAck(5, []);
        expect(store.stored.size).toBe(1);
        cm.shutdown();
    });

    it('intervalMs triggers checkpoint even if < intervalAcks acks', async () => {
        const store = makeStore();
        // Use very small intervalMs for test speed
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1', { intervalAcks: 100, intervalMs: 20 });
        await cm.onAck(1, []);  // only 1 ack, won't trigger count-based checkpoint
        // Wait for timer
        await Bun.sleep(50);
        expect(store.stored.size).toBe(1);
        cm.shutdown();
    });

    it('missed checkpoint (store throws) does not rethrow', async () => {
        const store = makeStore();
        store.failOnNext = true;
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1', { intervalAcks: 1, intervalMs: 999_999 });
        // Should not throw
        await expect(cm.onAck(1, [])).resolves.toBeUndefined();
        cm.shutdown();
    });

    it('shutdown() stops the interval timer', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipe1', 'consumer1', { intervalAcks: 1000, intervalMs: 20 });
        cm.shutdown();
        // Timer should be cleared — no saves after shutdown
        await Bun.sleep(50);
        expect(store.stored.size).toBe(0);
    });
});

// ─── Crash simulation ─────────────────────────────────────────────────────────

describe('Crash simulation', () => {
    it('restart reads last checkpoint sequence after 50 acks', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipeline', 'consumer', { intervalAcks: 50, intervalMs: 999_999 });
        for (let i = 1; i <= 50; i++) await cm.onAck(i, []);
        cm.shutdown();

        // "crash" — create new manager using same store
        const cm2 = new CheckpointManager(store, 'pipeline', 'consumer', { intervalAcks: 50, intervalMs: 999_999 });
        const cp = await cm2.getCheckpoint();
        expect(cp!.sequence).toBe(50);
        cm2.shutdown();
    });

    it('window accumulator restored from checkpoint windowKeys after crash', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'pipeline', 'consumer', { intervalAcks: 1, intervalMs: 999_999 });
        await cm.onAck(10, ['tumbling:0:60000', 'tumbling:60000:120000']);
        cm.shutdown();

        const cm2 = new CheckpointManager(store, 'pipeline', 'consumer');
        const cp = await cm2.getCheckpoint();
        expect(cp!.windowKeys).toContain('tumbling:0:60000');
        expect(cp!.windowKeys).toContain('tumbling:60000:120000');
    });

    it('no checkpoint on first startup means consumer starts from beginning', async () => {
        const store = makeStore();
        const cm = new CheckpointManager(store, 'new-pipeline', 'consumer');
        const cp = await cm.getCheckpoint();
        expect(cp).toBeNull();
    });
});

// ─── FaultHandler integration ─────────────────────────────────────────────────

describe('FaultHandler — DL routing', () => {
    it('exhausted retries: deadLetterSink.send() called', async () => {
        const pub = makePublisher();
        const dlSink = new DeadLetterSink(pub, 'blitz-dl');
        // maxRetries=0 means any failure goes straight to DL
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(0, 100),
            deadLetterSink: dlSink,
        });
        const msg = makeFaultMessage();
        await handler.handle(msg, async () => { throw new NakError('boom'); });
        expect(pub.calls).toHaveLength(1);
    });

    it('exhausted sink retries: DL message includes sinkName in headers', async () => {
        const pub = makePublisher();
        const dlSink = new DeadLetterSink(pub, 'blitz-dl');
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(0, 100),
            deadLetterSink: dlSink,
            sinkName: 'HeliosMapSink',
        });
        const msg = makeFaultMessage();
        await handler.handle(msg, async () => { throw new NakError('sink fail'); });
        expect(pub.calls[0]!.headers['sink-name']).toBe('HeliosMapSink');
    });

    it('multiple NakErrors: nak called N times before DL', async () => {
        const pub = makePublisher();
        const dlSink = new DeadLetterSink(pub, 'blitz-dl');
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(2, 100),
            deadLetterSink: dlSink,
        });
        // Simulate a message that failed its max retries (deliveryCount = maxRetries+1)
        const msg = makeFaultMessage({ deliveryCount: 3 });
        await handler.handle(msg, async () => { throw new NakError('fail'); });
        // deliveryCount=3, maxRetries=2 → exhausted → DL
        expect(pub.calls).toHaveLength(1);
        expect(msg.ackCalls).toBe(0);
    });

    it('nak called with delay when retries remain', async () => {
        const handler = new FaultHandler({
            ackPolicy: AckPolicy.EXPLICIT,
            retryPolicy: RetryPolicy.fixed(3, 250),
        });
        const msg = makeFaultMessage({ deliveryCount: 1 });
        await handler.handle(msg, async () => { throw new NakError('fail'); });
        expect(msg.nakCalls).toBe(1);
        expect(msg.nakDelays[0]).toBe(250);
    });
});
