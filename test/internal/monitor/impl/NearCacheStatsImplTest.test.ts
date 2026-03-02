/**
 * Port of {@code com.hazelcast.internal.monitor.impl.NearCacheStatsImplTest}.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { NearCacheStatsImpl } from '@helios/internal/monitor/impl/NearCacheStatsImpl';

describe('NearCacheStatsImplTest', () => {
    let nearCacheStats: NearCacheStatsImpl;

    beforeEach(() => {
        nearCacheStats = new NearCacheStatsImpl();

        nearCacheStats.setOwnedEntryCount(501);
        nearCacheStats.incrementOwnedEntryCount();
        nearCacheStats.decrementOwnedEntryCount();
        nearCacheStats.decrementOwnedEntryCount();

        nearCacheStats.setOwnedEntryMemoryCost(1024);
        nearCacheStats.incrementOwnedEntryMemoryCost(512);
        nearCacheStats.decrementOwnedEntryMemoryCost(256);

        nearCacheStats.setHits(600);
        nearCacheStats.incrementHits();
        nearCacheStats.incrementHits();

        nearCacheStats.setMisses(304);
        nearCacheStats.incrementMisses();

        nearCacheStats.incrementEvictions();
        nearCacheStats.incrementEvictions();
        nearCacheStats.incrementEvictions();
        nearCacheStats.incrementEvictions();

        nearCacheStats.incrementExpirations();
        nearCacheStats.incrementExpirations();
        nearCacheStats.incrementExpirations();

        nearCacheStats.incrementInvalidations(23);
        nearCacheStats.incrementInvalidations();

        nearCacheStats.incrementInvalidationRequests();
        nearCacheStats.incrementInvalidationRequests();

        nearCacheStats.addPersistence(200, 300, 400);
    });

    function assertNearCacheStats(
        stats: NearCacheStatsImpl,
        expectedPersistenceCount: number,
        expectedDuration: number,
        expectedWrittenBytes: number,
        expectedKeyCount: number,
        expectedFailure: boolean,
    ): void {
        expect(stats.getCreationTime()).toBeGreaterThan(0);
        expect(stats.getOwnedEntryCount()).toBe(500);
        expect(stats.getOwnedEntryMemoryCost()).toBe(1280);
        expect(stats.getHits()).toBe(602);
        expect(stats.getMisses()).toBe(305);
        expect(stats.getEvictions()).toBe(4);
        expect(stats.getExpirations()).toBe(3);
        expect(stats.getInvalidations()).toBe(24);
        expect(stats.getInvalidationRequests()).toBe(2);
        expect(stats.getPersistenceCount()).toBe(expectedPersistenceCount);
        expect(stats.getLastPersistenceTime()).toBeGreaterThan(0);
        expect(stats.getLastPersistenceDuration()).toBe(expectedDuration);
        expect(stats.getLastPersistenceWrittenBytes()).toBe(expectedWrittenBytes);
        expect(stats.getLastPersistenceKeyCount()).toBe(expectedKeyCount);
        if (expectedFailure) {
            expect(stats.getLastPersistenceFailure().length).toBeGreaterThan(0);
        } else {
            expect(stats.getLastPersistenceFailure()).toBe('');
        }
        expect(stats.toString()).toBeTruthy();
    }

    it('testDefaultConstructor', () => {
        assertNearCacheStats(nearCacheStats, 1, 200, 300, 400, false);
    });

    it('testCopyConstructor', () => {
        const copy = new NearCacheStatsImpl(nearCacheStats);
        assertNearCacheStats(copy, 1, 200, 300, 400, false);
    });

    it('testGetRatio_NaN', () => {
        const s = new NearCacheStatsImpl();
        expect(s.getRatio()).toBeNaN();
    });

    it('testGetRatio_POSITIVE_INFINITY', () => {
        const s = new NearCacheStatsImpl();
        s.setHits(1);
        expect(s.getRatio()).toBe(Infinity);
    });

    it('testGetRatio_100', () => {
        const s = new NearCacheStatsImpl();
        s.setHits(1);
        s.setMisses(1);
        expect(s.getRatio()).toBeCloseTo(100, 3);
    });
});
