/**
 * Tests for HeliosEventBridge — @nestjs/event-emitter integration.
 * Block 9.7.
 */
import { describe, it, expect, mock } from 'bun:test';
import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { HeliosModule } from '../../src/HeliosModule';
import { HELIOS_INSTANCE_TOKEN } from '../../src/HeliosInstanceDefinition';
import { HeliosEventBridge } from '../../src/events/helios-event-bridge';
import { HeliosEventBridgeModule } from '../../src/events/helios-event-bridge.module';
import type { HeliosInstance } from '@helios/core/core/HeliosInstance';
import type { EntryListener, EntryEvent } from '@helios/core/map/EntryListener';
import type { MessageListener } from '@helios/core/topic/MessageListener';
import type { LifecycleListener } from '@helios/core/instance/lifecycle/LifecycleListener';
import { EntryEventImpl } from '@helios/core/map/EntryListener';
import { Message } from '@helios/core/topic/Message';
import { LifecycleEvent, LifecycleState } from '@helios/core/instance/lifecycle/LifecycleEvent';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeHeliosInstance(overrides: Partial<HeliosInstance> = {}): HeliosInstance {
    const mapListeners = new Map<string, EntryListener<unknown, unknown>[]>();
    const topicListeners = new Map<string, MessageListener<unknown>[]>();
    const lifecycleListeners: LifecycleListener[] = [];

    return {
        getName: () => 'test-node',
        getMap: (name: string) => ({
            getName: () => name,
            addEntryListener: (listener: EntryListener<unknown, unknown>) => {
                const list = mapListeners.get(name) ?? [];
                list.push(listener);
                mapListeners.set(name, list);
                return `map-listener-${name}-${list.length}`;
            },
            removeEntryListener: (_id: string) => true,
            // fire helper (not part of IMap interface, used in tests via cast)
            _fireAdded: (key: unknown, value: unknown) => {
                const event = new EntryEventImpl(name, key, value, null, 'ADDED');
                mapListeners.get(name)?.forEach(l => l.entryAdded?.(event));
            },
            _fireUpdated: (key: unknown, value: unknown, oldValue: unknown) => {
                const event = new EntryEventImpl(name, key, value, oldValue, 'UPDATED');
                mapListeners.get(name)?.forEach(l => l.entryUpdated?.(event));
            },
            _fireRemoved: (key: unknown, oldValue: unknown) => {
                const event = new EntryEventImpl(name, key, null, oldValue, 'REMOVED');
                mapListeners.get(name)?.forEach(l => l.entryRemoved?.(event));
            },
            _fireEvicted: (key: unknown, oldValue: unknown) => {
                const event = new EntryEventImpl(name, key, null, oldValue, 'EVICTED');
                mapListeners.get(name)?.forEach(l => l.entryEvicted?.(event));
            },
        } as any),
        getTopic: (name: string) => ({
            getName: () => name,
            addMessageListener: (listener: MessageListener<unknown>) => {
                const list = topicListeners.get(name) ?? [];
                list.push(listener);
                topicListeners.set(name, list);
                return `topic-listener-${name}-${list.length}`;
            },
            removeMessageListener: (_id: string) => true,
            _fireMessage: (payload: unknown) => {
                const msg = new Message(name, payload, Date.now());
                topicListeners.get(name)?.forEach(l => l(msg));
            },
        } as any),
        getLifecycleService: () => ({
            isRunning: () => true,
            addLifecycleListener: (listener: LifecycleListener) => {
                lifecycleListeners.push(listener);
                return `lifecycle-${lifecycleListeners.length}`;
            },
            removeLifecycleListener: (_id: string) => true,
            shutdown: () => undefined,
            _fireLifecycle: (state: LifecycleState) => {
                const event = new LifecycleEvent(state);
                lifecycleListeners.forEach(l => l.stateChanged(event));
            },
        } as any),
        getCluster: () => ({ getMembers: () => [], getLocalMember: () => null as any }),
        getConfig: () => ({} as any),
        getQueue: () => { throw new Error('not used'); },
        getList: () => { throw new Error('not used'); },
        getSet: () => { throw new Error('not used'); },
        getMultiMap: () => { throw new Error('not used'); },
        getReplicatedMap: () => { throw new Error('not used'); },
        getDistributedObject: () => { throw new Error('not used'); },
        shutdown: () => undefined,
        ...overrides,
    } as unknown as HeliosInstance;
}

// ── bridgeMap() ───────────────────────────────────────────────────────────────

describe('HeliosEventBridge — bridgeMap()', () => {
    it('emits helios.map.<name>.added when an entry is added', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeMap('users');

        const received: EntryEvent<string, string>[] = [];
        ee.on('helios.map.users.added', (e: EntryEvent<string, string>) => received.push(e));

        (instance.getMap('users') as any)._fireAdded('alice', 'Alice');

        expect(received).toHaveLength(1);
        expect(received[0].getKey()).toBe('alice');
        expect(received[0].getValue()).toBe('Alice');
    });

    it('emits helios.map.<name>.updated when an entry is updated', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeMap('users');

        const received: EntryEvent<string, string>[] = [];
        ee.on('helios.map.users.updated', (e: EntryEvent<string, string>) => received.push(e));

        (instance.getMap('users') as any)._fireUpdated('alice', 'Alice2', 'Alice1');

        expect(received).toHaveLength(1);
        expect(received[0].getKey()).toBe('alice');
        expect(received[0].getValue()).toBe('Alice2');
        expect(received[0].getOldValue()).toBe('Alice1');
    });

    it('emits helios.map.<name>.removed when an entry is removed', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeMap('users');

        const received: EntryEvent<string, string>[] = [];
        ee.on('helios.map.users.removed', (e: EntryEvent<string, string>) => received.push(e));

        (instance.getMap('users') as any)._fireRemoved('alice', 'Alice');

        expect(received).toHaveLength(1);
        expect(received[0].getKey()).toBe('alice');
        expect(received[0].getOldValue()).toBe('Alice');
    });

    it('emits helios.map.<name>.evicted when an entry is evicted', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeMap('users');

        const received: EntryEvent<string, string>[] = [];
        ee.on('helios.map.users.evicted', (e: EntryEvent<string, string>) => received.push(e));

        (instance.getMap('users') as any)._fireEvicted('alice', 'Alice');

        expect(received).toHaveLength(1);
        expect(received[0].getKey()).toBe('alice');
    });

    it('uses the correct map name in the event namespace', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeMap('orders');

        const received: string[] = [];
        ee.on('helios.map.orders.added', () => received.push('orders'));
        ee.on('helios.map.users.added', () => received.push('users'));

        (instance.getMap('orders') as any)._fireAdded('o1', 'order-1');

        expect(received).toEqual(['orders']);
    });
});

// ── bridgeTopic() ─────────────────────────────────────────────────────────────

describe('HeliosEventBridge — bridgeTopic()', () => {
    it('emits helios.topic.<name> when a message is published', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeTopic('notifications');

        const received: Message<string>[] = [];
        ee.on('helios.topic.notifications', (msg: Message<string>) => received.push(msg));

        (instance.getTopic('notifications') as any)._fireMessage('Hello World');

        expect(received).toHaveLength(1);
        expect(received[0].getMessageObject()).toBe('Hello World');
        expect(received[0].getSource()).toBe('notifications');
    });

    it('emits helios.topic.<name> with the correct topic name', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeTopic('alerts');
        bridge.bridgeTopic('notifications');

        const alertReceived: unknown[] = [];
        const notifReceived: unknown[] = [];
        ee.on('helios.topic.alerts', (msg: unknown) => alertReceived.push(msg));
        ee.on('helios.topic.notifications', (msg: unknown) => notifReceived.push(msg));

        (instance.getTopic('alerts') as any)._fireMessage('ALERT!');

        expect(alertReceived).toHaveLength(1);
        expect(notifReceived).toHaveLength(0);
    });
});

// ── bridgeLifecycle() ────────────────────────────────────────────────────────

describe('HeliosEventBridge — bridgeLifecycle()', () => {
    it('emits helios.lifecycle.<STATE> for lifecycle events', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeLifecycle();

        const received: LifecycleEvent[] = [];
        ee.on('helios.lifecycle.STARTED', (e: LifecycleEvent) => received.push(e));

        (instance.getLifecycleService() as any)._fireLifecycle(LifecycleState.STARTED);

        expect(received).toHaveLength(1);
        expect(received[0].getState()).toBe(LifecycleState.STARTED);
    });

    it('emits helios.lifecycle.SHUTDOWN for shutdown state', () => {
        const ee = new EventEmitter2();
        const instance = makeHeliosInstance();
        const bridge = new HeliosEventBridge(instance, ee);

        bridge.bridgeLifecycle();

        const received: LifecycleEvent[] = [];
        ee.on('helios.lifecycle.SHUTDOWN', (e: LifecycleEvent) => received.push(e));

        (instance.getLifecycleService() as any)._fireLifecycle(LifecycleState.SHUTDOWN);

        expect(received).toHaveLength(1);
    });
});

// ── NestJS DI integration ─────────────────────────────────────────────────────

describe('HeliosEventBridgeModule — NestJS DI', () => {
    it('can be resolved from DI when HeliosModule and EventEmitterModule are imported', async () => {
        const instanceStub = makeHeliosInstance();
        const module = await Test.createTestingModule({
            imports: [
                HeliosModule.forRoot(instanceStub as unknown as HeliosInstance),
                EventEmitterModule.forRoot(),
                HeliosEventBridgeModule,
            ],
        }).compile();

        const bridge = module.get(HeliosEventBridge);
        expect(bridge).toBeDefined();
        expect(bridge).toBeInstanceOf(HeliosEventBridge);
    });

    it('HeliosEventBridge is exported and functional via DI', async () => {
        const instanceStub = makeHeliosInstance();
        const module = await Test.createTestingModule({
            imports: [
                HeliosModule.forRoot(instanceStub as unknown as HeliosInstance),
                EventEmitterModule.forRoot(),
                HeliosEventBridgeModule,
            ],
        }).compile();

        const bridge = module.get(HeliosEventBridge);
        const ee = module.get(EventEmitter2);

        bridge.bridgeTopic('di-test');

        const received: unknown[] = [];
        ee.on('helios.topic.di-test', (msg: unknown) => received.push(msg));

        (instanceStub.getTopic('di-test') as any)._fireMessage('from-di');

        expect(received).toHaveLength(1);
        expect((received[0] as Message<string>).getMessageObject()).toBe('from-di');
    });
});
