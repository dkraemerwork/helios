import { describe, it, expect } from 'bun:test';
import { NetworkConfig } from '@zenystx/helios-core/config/NetworkConfig';

describe('NetworkConfigTest', () => {
    let networkConfig: NetworkConfig;

    // Re-create before each test (using a closure approach)
    const makeConfig = () => new NetworkConfig();

    it('testPort', () => {
        const nc = makeConfig();
        const port = 12345; // fixed valid port instead of RandomPicker
        nc.setPort(port);
        expect(nc.getPort()).toBe(port);
    });

    it('testNegativePort', () => {
        expect(() => makeConfig().setPort(-1)).toThrow();
    });

    it('testOverLimitPort', () => {
        expect(() => makeConfig().setPort(65536)).toThrow();
    });

    it('testPortCount', () => {
        const nc = makeConfig();
        nc.setPortCount(111);
        expect(nc.getPortCount()).toBe(111);
    });

    it('testNegativePortCount', () => {
        expect(() => makeConfig().setPortCount(-1)).toThrow();
    });

    it('testPortAutoIncrement', () => {
        const nc = makeConfig();
        nc.setPortAutoIncrement(true);
        expect(nc.isPortAutoIncrement()).toBe(true);

        nc.setPortAutoIncrement(false);
        expect(nc.isPortAutoIncrement()).toBe(false);
    });

    it('testReuseAddress', () => {
        const nc = makeConfig();
        nc.setReuseAddress(true);
        expect(nc.isReuseAddress()).toBe(true);

        nc.setReuseAddress(false);
        expect(nc.isReuseAddress()).toBe(false);
    });

    it('testPublicAddress', () => {
        const nc = makeConfig();
        nc.setPublicAddress('hazelcast.org');
        expect(nc.getPublicAddress()).toBe('hazelcast.org');
    });

    it('testRestApiConfig_isNotNullByDefault', () => {
        expect(makeConfig().getRestApiConfig()).not.toBeNull();
    });

    it('testMemcacheProtocolConfig_isNotNullByDefault', () => {
        expect(makeConfig().getMemcacheProtocolConfig()).not.toBeNull();
    });
});
