/**
 * Tests for multicast config loading from JSON/YAML.
 *
 * Validates that the ConfigLoader correctly parses:
 * - Multicast enabled/disabled
 * - Multicast group, port, TTL, timeout
 * - Loopback mode
 * - Trusted interfaces
 * - TCP-IP config alongside multicast
 * - Both camelCase and kebab-case property names
 */
import { parseRawConfig } from '@zenystx/helios-core/config/ConfigLoader';
import { describe, expect, test } from 'bun:test';

describe('ConfigLoader — multicast config', () => {

    test('parses multicast enabled config', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                port: 5701,
                join: {
                    multicast: {
                        enabled: true,
                    },
                },
            },
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        expect(mc.isEnabled()).toBe(true);
    });

    test('parses multicast disabled config', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                join: {
                    multicast: {
                        enabled: false,
                    },
                },
            },
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        expect(mc.isEnabled()).toBe(false);
    });

    test('parses multicast group and port (kebab-case)', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                join: {
                    multicast: {
                        enabled: true,
                        'multicast-group': '239.1.2.3',
                        'multicast-port': 55555,
                    },
                },
            },
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        expect(mc.getMulticastGroup()).toBe('239.1.2.3');
        expect(mc.getMulticastPort()).toBe(55555);
    });

    test('parses multicast group and port (camelCase)', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                join: {
                    multicast: {
                        enabled: true,
                        multicastGroup: '239.1.2.4',
                        multicastPort: 55556,
                    },
                },
            },
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        expect(mc.getMulticastGroup()).toBe('239.1.2.4');
        expect(mc.getMulticastPort()).toBe(55556);
    });

    test('parses multicast timeout and TTL', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                join: {
                    multicast: {
                        enabled: true,
                        'multicast-timeout-seconds': 5,
                        'multicast-time-to-live': 64,
                    },
                },
            },
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        expect(mc.getMulticastTimeoutSeconds()).toBe(5);
        expect(mc.getMulticastTimeToLive()).toBe(64);
    });

    test('parses loopback mode', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                join: {
                    multicast: {
                        enabled: true,
                        'loopback-mode-enabled': true,
                    },
                },
            },
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        expect(mc.getLoopbackModeEnabled()).toBe(true);
    });

    test('parses trusted interfaces', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                join: {
                    multicast: {
                        enabled: true,
                        'trusted-interfaces': ['192.168.1.*', '10.0.0.*'],
                    },
                },
            },
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        const ifaces = mc.getTrustedInterfaces();
        expect(ifaces.size).toBe(2);
        expect(ifaces.has('192.168.1.*')).toBe(true);
        expect(ifaces.has('10.0.0.*')).toBe(true);
    });

    test('parses tcp-ip config', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                join: {
                    'tcp-ip': {
                        enabled: true,
                        members: ['192.168.1.100:5701', '192.168.1.101:5701'],
                    },
                },
            },
        });

        const tcpIp = config.getNetworkConfig().getJoin().getTcpIpConfig();
        expect(tcpIp.isEnabled()).toBe(true);
        expect(tcpIp.getMembers()).toHaveLength(2);
    });

    test('parses network port', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
            network: {
                port: 5702,
            },
        });

        expect(config.getNetworkConfig().getPort()).toBe(5702);
    });

    test('defaults are preserved when not configured', () => {
        const config = parseRawConfig({
            name: 'test-cluster',
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        expect(mc.isEnabled()).toBe(false);
        expect(mc.getMulticastGroup()).toBe('224.2.2.3');
        expect(mc.getMulticastPort()).toBe(54327);
        expect(mc.getMulticastTimeoutSeconds()).toBe(2);
        expect(mc.getMulticastTimeToLive()).toBe(32);
        expect(mc.getLoopbackModeEnabled()).toBeNull();
    });

    test('full multicast config with all fields (camelCase)', () => {
        const config = parseRawConfig({
            name: 'full-test',
            network: {
                port: 5703,
                join: {
                    multicast: {
                        enabled: true,
                        multicastGroup: '239.255.1.1',
                        multicastPort: 54328,
                        multicastTimeoutSeconds: 10,
                        multicastTimeToLive: 128,
                        loopbackModeEnabled: false,
                        trustedInterfaces: ['172.16.0.*'],
                    },
                },
            },
        });

        const mc = config.getNetworkConfig().getJoin().getMulticastConfig();
        expect(mc.isEnabled()).toBe(true);
        expect(mc.getMulticastGroup()).toBe('239.255.1.1');
        expect(mc.getMulticastPort()).toBe(54328);
        expect(mc.getMulticastTimeoutSeconds()).toBe(10);
        expect(mc.getMulticastTimeToLive()).toBe(128);
        expect(mc.getLoopbackModeEnabled()).toBe(false);
        expect(mc.getTrustedInterfaces().has('172.16.0.*')).toBe(true);
        expect(config.getNetworkConfig().getPort()).toBe(5703);
    });
});
