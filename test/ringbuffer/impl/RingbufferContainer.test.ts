/**
 * Port of {@code RingbufferContainerTest}.
 *
 * Tests RingbufferContainer construction, capacity, TTL, add, and read operations.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { InMemoryFormat } from '@helios/config/InMemoryFormat';
import { RingbufferConfig } from '@helios/config/RingbufferConfig';
import { RingbufferContainer } from '@helios/ringbuffer/impl/RingbufferContainer';
import { RingbufferService } from '@helios/ringbuffer/impl/RingbufferService';
import { TestNodeEngine } from '@helios/test-support/TestNodeEngine';
import { StaleSequenceException } from '@helios/ringbuffer/StaleSequenceException';

let nodeEngine: TestNodeEngine;

beforeEach(() => {
    nodeEngine = new TestNodeEngine();
});

function makeContainer<T = unknown, E = unknown>(config: RingbufferConfig): RingbufferContainer<T, E> {
    const ns = RingbufferService.getRingbufferNamespace(config.getName());
    return new RingbufferContainer<T, E>(ns, config, nodeEngine, 0);
}

// ── construction ───────────────────────────────────────────────────────────

describe('construction', () => {
    test('constructionNoTTL', () => {
        const config = new RingbufferConfig('foo').setCapacity(100).setTimeToLiveSeconds(0);
        const container = makeContainer(config);

        expect(container.getCapacity()).toBe(config.getCapacity());
        expect(container.getExpirationPolicy()).toBeNull();
        expect(container.getConfig()).toBe(config);

        const rb = container.getRingbuffer();
        expect(rb.getItems().length).toBe(config.getCapacity());
        expect(rb.tailSequence()).toBe(-1);
        expect(rb.headSequence()).toBe(0);
    });

    test('constructionWithTTL', () => {
        const config = new RingbufferConfig('foo').setCapacity(100).setTimeToLiveSeconds(30);
        const container = makeContainer(config);

        expect(container.getCapacity()).toBe(config.getCapacity());
        expect(container.getExpirationPolicy()).not.toBeNull();
        expect(container.getConfig()).toBe(config);
        expect(container.getExpirationPolicy()!.ringExpirationMs.length).toBe(config.getCapacity());
        expect(container.tailSequence()).toBe(-1);
        expect(container.headSequence()).toBe(0);
    });
});

// ── remainingCapacity ────────────────────────────────────────────────────

describe('remainingCapacity', () => {
    test('whenTTLDisabled', () => {
        const config = new RingbufferConfig('foo').setCapacity(100).setTimeToLiveSeconds(0);
        const rb = makeContainer(config);

        expect(rb.remainingCapacity()).toBe(config.getCapacity());

        rb.add(nodeEngine.toData('1')!);
        rb.add(nodeEngine.toData('2')!);
        // No TTL = always full capacity
        expect(rb.remainingCapacity()).toBe(config.getCapacity());
    });

    test('whenTTLEnabled', () => {
        const config = new RingbufferConfig('foo').setCapacity(100).setTimeToLiveSeconds(1);
        const rb = makeContainer(config);

        expect(rb.remainingCapacity()).toBe(config.getCapacity());

        rb.add(nodeEngine.toData('1')!);
        expect(rb.remainingCapacity()).toBe(config.getCapacity() - 1);

        rb.add(nodeEngine.toData('2')!);
        expect(rb.remainingCapacity()).toBe(config.getCapacity() - 2);
    });
});

// ── size ───────────────────────────────────────────────────────────────────

describe('size', () => {
    test('whenEmpty', () => {
        const config = new RingbufferConfig('foo').setCapacity(100);
        const rb = makeContainer(config);

        expect(rb.size()).toBe(0);
        expect(rb.isEmpty()).toBe(true);
    });

    test('whenAddingManyItems', () => {
        const config = new RingbufferConfig('foo').setCapacity(100);
        const rb = makeContainer(config);

        for (let k = 0; k < config.getCapacity(); k++) {
            rb.add(nodeEngine.toData('')!);
            expect(rb.size()).toBe(k + 1);
        }
        expect(rb.isEmpty()).toBe(false);

        // Ringbuffer full - overwrite oldest; size stays at capacity
        for (let k = 0; k < config.getCapacity(); k++) {
            rb.add(nodeEngine.toData('')!);
            expect(rb.size()).toBe(config.getCapacity());
        }
    });
});

// ── add ────────────────────────────────────────────────────────────────────

describe('add', () => {
    test('add', () => {
        const config = new RingbufferConfig('foo').setCapacity(10);
        const rb = makeContainer(config);
        rb.add(nodeEngine.toData('foo')!);
        rb.add(nodeEngine.toData('bar')!);

        expect(rb.tailSequence()).toBe(1);
        expect(rb.headSequence()).toBe(0);
    });

    test('add_whenWrapped - OBJECT format', () => {
        const config = new RingbufferConfig('foo')
            .setInMemoryFormat(InMemoryFormat.OBJECT)
            .setCapacity(3);
        const rb = makeContainer(config);

        rb.add(nodeEngine.toData('1')!);
        expect(rb.headSequence()).toBe(0);
        expect(rb.tailSequence()).toBe(0);
        // readAsData round-trips through serialization
        const d1 = rb.readAsData(0);
        expect(nodeEngine.toObject<string>(d1)).toBe('1');

        rb.add(nodeEngine.toData('2')!);
        expect(rb.tailSequence()).toBe(1);
        expect(rb.headSequence()).toBe(0);
        expect(nodeEngine.toObject<string>(rb.readAsData(0))).toBe('1');
        expect(nodeEngine.toObject<string>(rb.readAsData(1))).toBe('2');

        rb.add(nodeEngine.toData('3')!);
        expect(rb.tailSequence()).toBe(2);
        expect(rb.headSequence()).toBe(0);

        // Add 4th item - wraps and head moves to 1
        rb.add(nodeEngine.toData('4')!);
        expect(rb.tailSequence()).toBe(3);
        expect(rb.headSequence()).toBe(1);
        expect(nodeEngine.toObject<string>(rb.readAsData(1))).toBe('2');
        expect(nodeEngine.toObject<string>(rb.readAsData(2))).toBe('3');
        expect(nodeEngine.toObject<string>(rb.readAsData(3))).toBe('4');

        rb.add(nodeEngine.toData('5')!);
        expect(rb.tailSequence()).toBe(4);
        expect(rb.headSequence()).toBe(2);
        expect(nodeEngine.toObject<string>(rb.readAsData(2))).toBe('3');
        expect(nodeEngine.toObject<string>(rb.readAsData(3))).toBe('4');
        expect(nodeEngine.toObject<string>(rb.readAsData(4))).toBe('5');
    });

    test('read_whenStaleSequence', () => {
        const config = new RingbufferConfig('foo').setCapacity(3);
        const rb = makeContainer(config);

        rb.add(nodeEngine.toData('1')!);
        rb.add(nodeEngine.toData('2')!);
        rb.add(nodeEngine.toData('3')!);
        // 4th overwrites first
        rb.add(nodeEngine.toData('4')!);

        expect(() => rb.readAsData(0)).toThrow(StaleSequenceException);
    });

    test('add_whenBinaryInMemoryFormat', () => {
        const config = new RingbufferConfig('foo').setInMemoryFormat(InMemoryFormat.BINARY);
        const rb = makeContainer(config);

        rb.add(nodeEngine.toData('foo')!);
        // In BINARY mode, items stored as Data objects
        const items = rb.getRingbuffer().getItems();
        const item0 = items[0];
        expect(item0).not.toBeNull();
        // Item should be Data-like (has toByteArray)
        expect(typeof (item0 as { toByteArray?: unknown }).toByteArray).toBe('function');
    });

    test('add_inObjectInMemoryFormat', () => {
        const config = new RingbufferConfig('foo').setInMemoryFormat(InMemoryFormat.OBJECT);
        const rb = makeContainer(config);

        // Add as plain string
        rb.add('foo' as unknown);
        const items = rb.getRingbuffer().getItems();
        expect(typeof items[0]).toBe('string');
        expect(items[0]).toBe('foo');

        // Add as Data - should be deserialized to string
        rb.add(nodeEngine.toData('bar')!);
        expect(typeof items[1]).toBe('string');
        expect(items[1]).toBe('bar');
    });
});
