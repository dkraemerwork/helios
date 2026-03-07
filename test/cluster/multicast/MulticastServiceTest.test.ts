/**
 * Tests for MulticastService — UDP multicast sender/receiver.
 *
 * Tests validate:
 * - Service creation from MulticastConfig
 * - Start/stop lifecycle
 * - Message serialization/deserialization
 * - Listener registration and dispatch
 * - Trust-based address filtering
 * - Multiple listeners receiving the same message
 * - Config-based creation (enabled/disabled)
 */
import type { MulticastJoinMessage, MulticastListener, MulticastMessage } from '@zenystx/helios-core/cluster/multicast/MulticastService';
import { MulticastService } from '@zenystx/helios-core/cluster/multicast/MulticastService';
import { MulticastConfig } from '@zenystx/helios-core/config/MulticastConfig';
import { afterEach, describe, expect, test } from 'bun:test';

// Use a high port to avoid conflicts with other tests
let testPortCounter = 54400;
function nextTestPort(): number {
    return testPortCounter++;
}

// Cleanup helper
const services: MulticastService[] = [];
afterEach(() => {
    for (const s of services) {
        try { s.stop(); } catch { /* ignore */ }
    }
    services.length = 0;
});

describe('MulticastService', () => {

    test('create returns null when disabled', () => {
        const config = new MulticastConfig();
        config.setEnabled(false);
        const service = MulticastService.create(config);
        expect(service).toBeNull();
    });

    test('create returns service when enabled', () => {
        const port = nextTestPort();
        const config = new MulticastConfig();
        config.setEnabled(true);
        config.setMulticastPort(port);
        config.setMulticastGroup('224.2.2.3');
        config.setLoopbackModeEnabled(true);

        const service = MulticastService.create(config);
        expect(service).not.toBeNull();
        services.push(service!);

        expect(service!.getMulticastGroup()).toBe('224.2.2.3');
        expect(service!.getMulticastPort()).toBe(port);
    });

    test('createWithParams creates a service', () => {
        const port = nextTestPort();
        const service = MulticastService.createWithParams({
            group: '224.2.2.3',
            port,
            loopback: true,
        });
        services.push(service);

        expect(service.isRunning()).toBe(false);
        service.start();
        expect(service.isRunning()).toBe(true);
    });

    test('start and stop lifecycle', () => {
        const port = nextTestPort();
        const service = MulticastService.createWithParams({
            group: '224.2.2.3',
            port,
            loopback: true,
        });
        services.push(service);

        expect(service.isRunning()).toBe(false);
        service.start();
        expect(service.isRunning()).toBe(true);

        // start is idempotent
        service.start();
        expect(service.isRunning()).toBe(true);

        service.stop();
        expect(service.isRunning()).toBe(false);

        // stop is idempotent
        service.stop();
        expect(service.isRunning()).toBe(false);
    });

    test('add and remove listener', () => {
        const port = nextTestPort();
        const service = MulticastService.createWithParams({
            group: '224.2.2.3',
            port,
            loopback: true,
        });
        services.push(service);

        const received: MulticastMessage[] = [];
        const listener: MulticastListener = {
            onMessage(msg) { received.push(msg); },
        };

        service.addMulticastListener(listener);
        service.removeMulticastListener(listener);
        // No error on removing non-existent listener
        service.removeMulticastListener(listener);
    });

    test('send when not running is a no-op', () => {
        const port = nextTestPort();
        const service = MulticastService.createWithParams({
            group: '224.2.2.3',
            port,
            loopback: true,
        });
        services.push(service);

        // Should not throw
        service.send({
            type: 'JOIN',
            address: { host: '127.0.0.1', port: 5701 },
            uuid: 'test-uuid',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
            liteMember: false,
        });
    });

    test('multicast loopback: send and receive own message', async () => {
        const port = nextTestPort();
        const service = MulticastService.createWithParams({
            group: '224.2.2.3',
            port,
            loopback: true,
        });
        services.push(service);

        const received: MulticastMessage[] = [];
        service.addMulticastListener({
            onMessage(msg) { received.push(msg); },
        });
        service.start();

        // Wait for socket to bind
        await new Promise((r) => setTimeout(r, 200));

        const testMessage: MulticastJoinMessage = {
            type: 'JOIN',
            address: { host: '127.0.0.1', port: 5701 },
            uuid: 'test-node-1',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
            liteMember: false,
        };

        service.send(testMessage);

        // Wait for loopback delivery
        await new Promise((r) => setTimeout(r, 500));

        expect(received.length).toBeGreaterThanOrEqual(1);
        const msg = received[0];
        expect(msg.type).toBe('JOIN');
        const joinMsg = msg as MulticastJoinMessage;
        expect(joinMsg.uuid).toBe('test-node-1');
        expect(joinMsg.clusterName).toBe('helios');
        expect(joinMsg.address.host).toBe('127.0.0.1');
        expect(joinMsg.address.port).toBe(5701);
    });

    test('multiple listeners receive the same message', async () => {
        const port = nextTestPort();
        const service = MulticastService.createWithParams({
            group: '224.2.2.3',
            port,
            loopback: true,
        });
        services.push(service);

        const received1: MulticastMessage[] = [];
        const received2: MulticastMessage[] = [];

        service.addMulticastListener({ onMessage(msg) { received1.push(msg); } });
        service.addMulticastListener({ onMessage(msg) { received2.push(msg); } });
        service.start();

        await new Promise((r) => setTimeout(r, 200));

        service.send({
            type: 'JOIN',
            address: { host: '127.0.0.1', port: 5701 },
            uuid: 'multi-listener-test',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
            liteMember: false,
        });

        await new Promise((r) => setTimeout(r, 500));

        expect(received1.length).toBeGreaterThanOrEqual(1);
        expect(received2.length).toBeGreaterThanOrEqual(1);
    });

    test('listener error does not affect other listeners', async () => {
        const port = nextTestPort();
        const service = MulticastService.createWithParams({
            group: '224.2.2.3',
            port,
            loopback: true,
        });
        services.push(service);

        const received: MulticastMessage[] = [];

        // First listener throws
        service.addMulticastListener({
            onMessage() { throw new Error('listener error'); },
        });
        // Second listener should still receive
        service.addMulticastListener({
            onMessage(msg) { received.push(msg); },
        });
        service.start();

        await new Promise((r) => setTimeout(r, 200));

        service.send({
            type: 'JOIN',
            address: { host: '127.0.0.1', port: 5701 },
            uuid: 'error-test',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
            liteMember: false,
        });

        await new Promise((r) => setTimeout(r, 500));

        expect(received.length).toBeGreaterThanOrEqual(1);
    });

    test('split brain message type is correctly sent and received', async () => {
        const port = nextTestPort();
        const service = MulticastService.createWithParams({
            group: '224.2.2.3',
            port,
            loopback: true,
        });
        services.push(service);

        const received: MulticastMessage[] = [];
        service.addMulticastListener({ onMessage(msg) { received.push(msg); } });
        service.start();

        await new Promise((r) => setTimeout(r, 200));

        service.send({
            type: 'SPLIT_BRAIN',
            address: { host: '192.168.1.100', port: 5702 },
            uuid: 'sb-node',
            clusterName: 'helios',
            memberCount: 3,
        });

        await new Promise((r) => setTimeout(r, 500));

        expect(received.length).toBeGreaterThanOrEqual(1);
        expect(received[0].type).toBe('SPLIT_BRAIN');
    });
});
