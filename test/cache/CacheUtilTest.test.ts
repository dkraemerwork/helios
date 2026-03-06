/**
 * Port of {@code com.hazelcast.cache.CacheUtilTest}.
 */
import { describe, expect, test } from 'bun:test';
import { CacheUtil } from '@zenystx/helios-core/cache/CacheUtil';
import { CACHE_MANAGER_PREFIX } from '@zenystx/helios-core/cache/HazelcastCacheManager';

const CACHE_NAME = 'MY-CACHE';
const URI_SCOPE = 'MY-SCOPE';
const CLASSLOADER_SCOPE = 'MY-CLASSLOADER';

type Params = {
    uri: string | null;
    classLoader: string | null;
    expectedPrefix: string | null;
    expectedPrefixedCacheName: string;
    expectedDistributedObjectName: string;
};

const parameters: Params[] = [
    {
        uri: null,
        classLoader: null,
        expectedPrefix: null,
        expectedPrefixedCacheName: CACHE_NAME,
        expectedDistributedObjectName: CACHE_MANAGER_PREFIX + CACHE_NAME,
    },
    {
        uri: URI_SCOPE,
        classLoader: null,
        expectedPrefix: URI_SCOPE + '/',
        expectedPrefixedCacheName: URI_SCOPE + '/' + CACHE_NAME,
        expectedDistributedObjectName: CACHE_MANAGER_PREFIX + URI_SCOPE + '/' + CACHE_NAME,
    },
    {
        uri: null,
        classLoader: CLASSLOADER_SCOPE,
        expectedPrefix: CLASSLOADER_SCOPE + '/',
        expectedPrefixedCacheName: CLASSLOADER_SCOPE + '/' + CACHE_NAME,
        expectedDistributedObjectName: CACHE_MANAGER_PREFIX + CLASSLOADER_SCOPE + '/' + CACHE_NAME,
    },
    {
        uri: URI_SCOPE,
        classLoader: CLASSLOADER_SCOPE,
        expectedPrefix: URI_SCOPE + '/' + CLASSLOADER_SCOPE + '/',
        expectedPrefixedCacheName: URI_SCOPE + '/' + CLASSLOADER_SCOPE + '/' + CACHE_NAME,
        expectedDistributedObjectName: CACHE_MANAGER_PREFIX + URI_SCOPE + '/' + CLASSLOADER_SCOPE + '/' + CACHE_NAME,
    },
];

describe('CacheUtilTest', () => {
    for (const params of parameters) {
        const label = `uri=${params.uri}, classLoader=${params.classLoader}`;

        test(`testGetPrefix [${label}]`, () => {
            const prefix = CacheUtil.getPrefix(params.uri, params.classLoader);
            expect(prefix).toBe(params.expectedPrefix);
        });

        test(`testGetPrefixedCacheName [${label}]`, () => {
            const result = CacheUtil.getPrefixedCacheName(CACHE_NAME, params.uri, params.classLoader);
            expect(result).toBe(params.expectedPrefixedCacheName);
        });

        test(`testGetDistributedObjectName [${label}]`, () => {
            const result = CacheUtil.getDistributedObjectName(CACHE_NAME, params.uri, params.classLoader);
            expect(result).toBe(params.expectedDistributedObjectName);
        });

        test(`testCacheManagerPrefix_usedCorrectly [${label}]`, () => {
            const result = CacheUtil.getDistributedObjectName(CACHE_NAME, params.uri, params.classLoader);
            expect(result.startsWith(CACHE_MANAGER_PREFIX)).toBe(true);
        });
    }
});
