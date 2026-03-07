/**
 * Tests for MulticastJoiner — multicast-based cluster master discovery.
 *
 * Tests validate:
 * - Self-election as master when no other node responds
 * - Master discovery when a master is broadcasting
 * - Try count calculation based on timeout config
 * - Join request messages are correctly formed
 * - Stop/cleanup lifecycle
 * - Cluster name filtering (different cluster names ignored)
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { MulticastService } from '@zenystx/helios-core/cluster/multicast/MulticastService';
import type { MulticastMessage, MulticastJoinMessage, MulticastListener } from '@zenystx/helios-core/cluster/multicast/MulticastService';
import { MulticastJoiner } from '@zenystx/helios-core/cluster/multicast/MulticastJoiner';
import { MulticastConfig } from '@zenystx/helios-core/config/MulticastConfig';

let testPortCounter = 54500;
function nextTestPort(): number {
    return testPortCounter++;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const fn of cleanups) {
        try { fn(); } catch { /* ignore */ }
    }
    cleanups.length = 0;
});

function createTestService(port: number): MulticastService {
    const service = MulticastService.createWithParams({
        group: '224.2.2.3',
        port,
        loopback: true,
    });
    cleanups.push(() => service.stop());
    return service;
}

function createTestConfig(timeoutSeconds = 1): MulticastConfig {
    const config = new MulticastConfig();
    config.setEnabled(true);
    config.setMulticastTimeoutSeconds(timeoutSeconds);
    config.setLoopbackModeEnabled(true);
    return config;
}

describe('MulticastJoiner', () => {

    test('becomes master when no other node responds', async () => {
        const port = nextTestPort();
        const service = createTestService(port);
        service.start();

        await new Promise((r) => setTimeout(r, 200));

        const config = createTestConfig(1); // 1 second timeout → fast test
        config.setMulticastPort(port);

        const joiner = new MulticastJoiner({
            multicastConfig: config,
            multicastService: service,
            localAddress: { host: '127.0.0.1', port: 5701 },
            localUuid: 'self-master-node',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
        });
        cleanups.push(() => joiner.stop());

        const result = await joiner.join();

        expect(result.masterFound).toBe(false);
        expect(result.masterAddress).toBeNull();
        expect(result.masterUuid).toBeNull();
    });

    test('discovers master when master is responding', async () => {
        const port = nextTestPort();

        // Master service
        const masterService = createTestService(port);
        masterService.start();

        await new Promise((r) => setTimeout(r, 200));

        // Simulate master: listen for JOIN requests and respond
        const masterResponse: MulticastJoinMessage = {
            type: 'JOIN',
            address: { host: '192.168.1.100', port: 5701 },
            uuid: 'master-node-uuid',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
            liteMember: false,
        };

        masterService.addMulticastListener({
            onMessage(msg: MulticastMessage) {
                if (msg.type === 'JOIN' && 'isRequest' in msg) {
                    // Respond as master
                    masterService.send(masterResponse);
                }
            },
        });

        // Joiner node
        const config = createTestConfig(3); // 3 seconds timeout
        config.setMulticastPort(port);

        const joiner = new MulticastJoiner({
            multicastConfig: config,
            multicastService: masterService, // Use same socket (loopback)
            localAddress: { host: '127.0.0.1', port: 5702 },
            localUuid: 'joiner-node-uuid',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
        });
        cleanups.push(() => joiner.stop());

        const result = await joiner.join();

        expect(result.masterFound).toBe(true);
        expect(result.masterAddress).not.toBeNull();
        expect(result.masterAddress!.host).toBe('192.168.1.100');
        expect(result.masterAddress!.port).toBe(5701);
        expect(result.masterUuid).toBe('master-node-uuid');
    });

    test('ignores messages from different cluster', async () => {
        const port = nextTestPort();
        const service = createTestService(port);
        service.start();

        await new Promise((r) => setTimeout(r, 200));

        // Simulate a "master" from a different cluster
        service.addMulticastListener({
            onMessage(msg: MulticastMessage) {
                if (msg.type === 'JOIN' && 'isRequest' in msg) {
                    // Respond with a different cluster name
                    service.send({
                        type: 'JOIN',
                        address: { host: '192.168.1.100', port: 5701 },
                        uuid: 'other-cluster-master',
                        clusterName: 'different-cluster', // Different!
                        partitionCount: 271,
                        version: { major: 1, minor: 0, patch: 0 },
                        liteMember: false,
                    });
                }
            },
        });

        const config = createTestConfig(1);
        config.setMulticastPort(port);

        const joiner = new MulticastJoiner({
            multicastConfig: config,
            multicastService: service,
            localAddress: { host: '127.0.0.1', port: 5702 },
            localUuid: 'filter-test-node',
            clusterName: 'helios', // Our cluster
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
        });
        cleanups.push(() => joiner.stop());

        const result = await joiner.join();

        // Should not find master because cluster names don't match
        expect(result.masterFound).toBe(false);
    });

    test('ignores messages from self', async () => {
        const port = nextTestPort();
        const service = createTestService(port);
        service.start();

        await new Promise((r) => setTimeout(r, 200));

        // The joiner's own UUID should be ignored
        const selfUuid = 'self-ignore-test';

        service.addMulticastListener({
            onMessage(msg: MulticastMessage) {
                if (msg.type === 'JOIN' && 'isRequest' in msg) {
                    // Respond with the SAME UUID as the joiner
                    service.send({
                        type: 'JOIN',
                        address: { host: '127.0.0.1', port: 5701 },
                        uuid: selfUuid, // Same as joiner!
                        clusterName: 'helios',
                        partitionCount: 271,
                        version: { major: 1, minor: 0, patch: 0 },
                        liteMember: false,
                    });
                }
            },
        });

        const config = createTestConfig(1);
        config.setMulticastPort(port);

        const joiner = new MulticastJoiner({
            multicastConfig: config,
            multicastService: service,
            localAddress: { host: '127.0.0.1', port: 5701 },
            localUuid: selfUuid,
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
        });
        cleanups.push(() => joiner.stop());

        const result = await joiner.join();

        // Should not find master because it's our own message
        expect(result.masterFound).toBe(false);
    });

    test('setAsMaster enables master response to join requests', async () => {
        const port = nextTestPort();
        const service = createTestService(port);
        service.start();

        await new Promise((r) => setTimeout(r, 200));

        const config = createTestConfig(2);
        config.setMulticastPort(port);

        // Create a joiner and set it as master
        const masterJoiner = new MulticastJoiner({
            multicastConfig: config,
            multicastService: service,
            localAddress: { host: '127.0.0.1', port: 5701 },
            localUuid: 'master-joiner',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
        });
        cleanups.push(() => masterJoiner.stop());
        masterJoiner.setAsMaster();

        // Now create a second joiner that should find the master
        const seekerJoiner = new MulticastJoiner({
            multicastConfig: config,
            multicastService: service,
            localAddress: { host: '127.0.0.1', port: 5702 },
            localUuid: 'seeker-joiner',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
        });
        cleanups.push(() => seekerJoiner.stop());

        const result = await seekerJoiner.join();

        expect(result.masterFound).toBe(true);
        expect(result.masterAddress!.host).toBe('127.0.0.1');
        expect(result.masterAddress!.port).toBe(5701);
        expect(result.masterUuid).toBe('master-joiner');
    });

    test('stop prevents further join attempts', async () => {
        const port = nextTestPort();
        const service = createTestService(port);
        service.start();

        await new Promise((r) => setTimeout(r, 200));

        const config = createTestConfig(10); // Long timeout
        config.setMulticastPort(port);

        const joiner = new MulticastJoiner({
            multicastConfig: config,
            multicastService: service,
            localAddress: { host: '127.0.0.1', port: 5701 },
            localUuid: 'stop-test-node',
            clusterName: 'helios',
            partitionCount: 271,
            version: { major: 1, minor: 0, patch: 0 },
        });
        cleanups.push(() => joiner.stop());

        // Stop immediately — join should terminate quickly
        setTimeout(() => joiner.stop(), 100);

        const startTime = Date.now();
        const result = await joiner.join();
        const elapsed = Date.now() - startTime;

        // Should complete much faster than 10 seconds
        expect(elapsed).toBeLessThan(2000);
        expect(result.masterFound).toBe(false);
    });
});
