/**
 * Port of {@code com.hazelcast.client.ClientNearCacheConfigTest}.
 *
 * Tests NearCacheConfig wildcard pattern matching via ClientConfig.
 */
import { describe, test, expect } from 'bun:test';
import { ClientConfig } from '@zenystx/helios-core/client/config';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';

describe('ClientNearCacheConfigTest', () => {
    test('testSpecificNearCacheConfig_whenAsteriskAtTheEnd', () => {
        const clientConfig = new ClientConfig();

        const genericNearCacheConfig = new NearCacheConfig();
        genericNearCacheConfig.setName('map*');
        clientConfig.addNearCacheConfig(genericNearCacheConfig);

        const specificNearCacheConfig = new NearCacheConfig();
        specificNearCacheConfig.setName('mapStudent*');
        clientConfig.addNearCacheConfig(specificNearCacheConfig);

        const mapFoo = clientConfig.getNearCacheConfig('mapFoo');
        const mapStudentFoo = clientConfig.getNearCacheConfig('mapStudentFoo');

        expect(mapFoo).toBe(genericNearCacheConfig);
        expect(mapStudentFoo).toBe(specificNearCacheConfig);
    });

    test('testSpecificNearCacheConfig_whenAsteriskAtTheBeginning', () => {
        const clientConfig = new ClientConfig();

        const genericNearCacheConfig = new NearCacheConfig();
        genericNearCacheConfig.setName('*Map');
        clientConfig.addNearCacheConfig(genericNearCacheConfig);

        const specificNearCacheConfig = new NearCacheConfig();
        specificNearCacheConfig.setName('*MapStudent');
        clientConfig.addNearCacheConfig(specificNearCacheConfig);

        const mapFoo = clientConfig.getNearCacheConfig('fooMap');
        const mapStudentFoo = clientConfig.getNearCacheConfig('fooMapStudent');

        expect(mapFoo).toBe(genericNearCacheConfig);
        expect(mapStudentFoo).toBe(specificNearCacheConfig);
    });

    test('testSpecificNearCacheConfig_whenAsteriskInTheMiddle', () => {
        const clientConfig = new ClientConfig();

        const genericNearCacheConfig = new NearCacheConfig();
        genericNearCacheConfig.setName('map*Bar');
        clientConfig.addNearCacheConfig(genericNearCacheConfig);

        const specificNearCacheConfig = new NearCacheConfig();
        specificNearCacheConfig.setName('mapStudent*Bar');
        clientConfig.addNearCacheConfig(specificNearCacheConfig);

        const mapFoo = clientConfig.getNearCacheConfig('mapFooBar');
        const mapStudentFoo = clientConfig.getNearCacheConfig('mapStudentFooBar');

        expect(mapFoo).toBe(genericNearCacheConfig);
        expect(mapStudentFoo).toBe(specificNearCacheConfig);
    });

    test('getNearCacheConfig returns null for no match', () => {
        const clientConfig = new ClientConfig();
        const config = new NearCacheConfig();
        config.setName('map*');
        clientConfig.addNearCacheConfig(config);

        expect(clientConfig.getNearCacheConfig('cache-foo')).toBeNull();
    });

    test('getNearCacheConfig returns default config when present', () => {
        const clientConfig = new ClientConfig();
        const defaultConfig = new NearCacheConfig('default');
        clientConfig.addNearCacheConfig(defaultConfig);

        // 'default' config is returned as fallback when no pattern matches
        const result = clientConfig.getNearCacheConfig('noMatchHere');
        // Should return a copy of the default config (or the same object)
        expect(result).not.toBeNull();
        expect(result!.getName()).toBe('default');
    });

    test('addNearCacheConfig stores by name and is retrievable', () => {
        const clientConfig = new ClientConfig();
        const config = new NearCacheConfig('myCache');
        clientConfig.addNearCacheConfig(config);

        // Exact match (no wildcard) does NOT match via pattern — only wildcard patterns match
        // But 'myCache' stored as-is; exact name without wildcard → no wildcard = no match
        const nearCacheConfigMap = clientConfig.getNearCacheConfigMap();
        expect(nearCacheConfigMap.get('myCache')).toBe(config);
    });
});
