/**
 * Port of {@code com.hazelcast.spi.impl.NodeEngineTest}.
 *
 * Tests for NodeEngineImpl service lookup, serialization delegation, and
 * logger management. Uses a TestSerializationService (no real cluster needed).
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { NodeEngineImpl } from '@zenystx/core/spi/impl/NodeEngineImpl';
import { TestSerializationService } from '@zenystx/core/test-support/TestSerializationService';
import { HeliosException } from '@zenystx/core/core/exception/HeliosException';

const MY_SERVICE = 'my.service';

class MyService {
    greet(): string { return 'hello'; }
}

function makeEngine(): NodeEngineImpl {
    return new NodeEngineImpl(new TestSerializationService());
}

describe('NodeEngineImpl.getServiceOrNull()', () => {
    it('returns null when service is not registered', () => {
        const engine = makeEngine();
        expect(engine.getServiceOrNull('non.existent')).toBeNull();
    });

    it('returns the service when registered', () => {
        const engine = makeEngine();
        const svc = new MyService();
        engine.registerService(MY_SERVICE, svc);
        expect(engine.getServiceOrNull<MyService>(MY_SERVICE)).toBe(svc);
    });

    it('returns null for null/undefined name instead of throwing', () => {
        const engine = makeEngine();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(engine.getServiceOrNull(null as any)).toBeNull();
    });
});

describe('NodeEngineImpl.getService()', () => {
    it('throws HeliosException when service is not registered', () => {
        const engine = makeEngine();
        expect(() => engine.getService('ghost')).toThrow(HeliosException);
    });

    it('returns the service when registered', () => {
        const engine = makeEngine();
        const svc = new MyService();
        engine.registerService(MY_SERVICE, svc);
        const found = engine.getService<MyService>(MY_SERVICE);
        expect(found).toBe(svc);
        expect(found.greet()).toBe('hello');
    });

    it('throws when serviceName is null', () => {
        const engine = makeEngine();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => engine.getService(null as any)).toThrow();
    });
});

describe('NodeEngineImpl serialization', () => {
    it('toData(null) returns null', () => {
        const engine = makeEngine();
        expect(engine.toData(null)).toBeNull();
    });

    it('toData(object) returns a Data instance', () => {
        const engine = makeEngine();
        const data = engine.toData({ x: 1 });
        expect(data).not.toBeNull();
    });

    it('toObject(null) returns null', () => {
        const engine = makeEngine();
        expect(engine.toObject(null)).toBeNull();
    });

    it('toObject(data) round-trips correctly', () => {
        const engine = makeEngine();
        const original = { key: 'value', num: 42 };
        const data = engine.toData(original)!;
        const restored = engine.toObject<{ key: string; num: number }>(data);
        expect(restored).toEqual(original);
    });
});

describe('NodeEngineImpl.getLogger()', () => {
    it('returns an ILogger for a string name', () => {
        const engine = makeEngine();
        const logger = engine.getLogger('com.example.Test');
        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
    });

    it('returns the same ILogger instance for the same name (cached)', () => {
        const engine = makeEngine();
        const a = engine.getLogger('same.name');
        const b = engine.getLogger('same.name');
        expect(a).toBe(b);
    });

    it('throws when null name is passed', () => {
        const engine = makeEngine();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => engine.getLogger(null as any)).toThrow();
    });
});

describe('NodeEngineImpl lifecycle', () => {
    it('isRunning returns true after construction', () => {
        const engine = makeEngine();
        expect(engine.isRunning()).toBe(true);
    });

    it('isRunning returns false after shutdown()', () => {
        const engine = makeEngine();
        engine.shutdown();
        expect(engine.isRunning()).toBe(false);
    });
});
