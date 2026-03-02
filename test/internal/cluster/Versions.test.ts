/**
 * Port of com.hazelcast.internal.cluster.VersionsTest
 */
import { describe, test, expect } from 'bun:test';
import { Versions } from '@helios/internal/cluster/Versions';
import { Version } from '@helios/version/Version';

describe('VersionsTest', () => {
    test('version_4_0', () => {
        expect(Versions.V4_0.equals(Version.of(4, 0))).toBe(true);
    });

    test('version_4_1', () => {
        expect(Versions.V4_1.equals(Version.of(4, 1))).toBe(true);
    });

    test('testParse', () => {
        const version = Versions.CURRENT_CLUSTER_VERSION;
        expect(version.equals(Version.of(version.toString()))).toBe(true);
    });

    test('testCurrentVersion', () => {
        // CURRENT_CLUSTER_VERSION should be a valid, non-UNKNOWN version
        expect(Versions.CURRENT_CLUSTER_VERSION.isUnknown()).toBe(false);
    });
});
