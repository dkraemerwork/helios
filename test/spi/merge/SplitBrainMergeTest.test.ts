/**
 * Tests for split-brain merge policies and the SplitBrainMergeHandler.
 * Verifies all 8 merge policies and the merge orchestration flow.
 */
import { describe, expect, test } from 'bun:test';
import { SplitBrainMergeDataImpl } from '@zenystx/helios-core/spi/merge/SplitBrainMergeDataImpl';
import { PassThroughMergePolicy } from '@zenystx/helios-core/spi/merge/PassThroughMergePolicy';
import { PutIfAbsentMergePolicy } from '@zenystx/helios-core/spi/merge/PutIfAbsentMergePolicy';
import { HigherHitsMergePolicy } from '@zenystx/helios-core/spi/merge/HigherHitsMergePolicy';
import { LatestUpdateMergePolicy } from '@zenystx/helios-core/spi/merge/LatestUpdateMergePolicy';
import { LatestAccessMergePolicy } from '@zenystx/helios-core/spi/merge/LatestAccessMergePolicy';
import { ExpirationTimeMergePolicy } from '@zenystx/helios-core/spi/merge/ExpirationTimeMergePolicy';
import { DiscardMergePolicy } from '@zenystx/helios-core/spi/merge/DiscardMergePolicy';
import { HyperLogLogMergePolicy } from '@zenystx/helios-core/spi/merge/HyperLogLogMergePolicy';
import { MergePolicyProvider } from '@zenystx/helios-core/spi/merge/MergePolicyProvider';
import { SplitBrainMergeHandler } from '@zenystx/helios-core/internal/cluster/impl/SplitBrainMergeHandler';
import { SplitBrainDetector } from '@zenystx/helios-core/internal/cluster/impl/SplitBrainDetector';
import { HeliosLifecycleService } from '@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService';
import { LifecycleState } from '@zenystx/helios-core/instance/lifecycle/LifecycleEvent';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { TestSerializationService } from '@zenystx/helios-core/test-support/TestSerializationService';
import type { SplitBrainMergeData } from '@zenystx/helios-core/spi/merge/MergingValue';
import type { MergeableMapStore } from '@zenystx/helios-core/internal/cluster/impl/SplitBrainMergeHandler';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _serializer = new TestSerializationService();

function makeData(value: string): Data {
    return _serializer.toData(value)!;
}

function makeEntry(
    key: string,
    value: string,
    {
        hits = 0,
        creationTime = 0,
        lastAccessTime = 0,
        lastUpdateTime = 0,
        expirationTime = Number.MAX_SAFE_INTEGER,
        version = 0,
    }: Partial<{
        hits: number;
        creationTime: number;
        lastAccessTime: number;
        lastUpdateTime: number;
        expirationTime: number;
        version: number;
    }> = {},
): SplitBrainMergeData {
    return new SplitBrainMergeDataImpl(
        makeData(key),
        makeData(value),
        hits,
        creationTime,
        lastAccessTime,
        lastUpdateTime,
        expirationTime,
        version,
    );
}

// ─── SplitBrainMergeDataImpl ──────────────────────────────────────────────────

describe('SplitBrainMergeDataImpl', () => {
    test('stores and returns all fields', () => {
        const key = makeData('k');
        const value = makeData('v');
        const entry = new SplitBrainMergeDataImpl(key, value, 5, 100, 200, 300, 1000, 2);

        expect(entry.getKey()).toBe(key);
        expect(entry.getValue()).toBe(value);
        expect(entry.getHits()).toBe(5);
        expect(entry.getCreationTime()).toBe(100);
        expect(entry.getLastAccessTime()).toBe(200);
        expect(entry.getLastUpdateTime()).toBe(300);
        expect(entry.getExpirationTime()).toBe(1000);
        expect(entry.getVersion()).toBe(2);
    });

    test('uses defaults for optional fields', () => {
        const key = makeData('k');
        const entry = new SplitBrainMergeDataImpl(key, null);

        expect(entry.getValue()).toBeNull();
        expect(entry.getHits()).toBe(0);
        expect(entry.getExpirationTime()).toBe(Number.MAX_SAFE_INTEGER);
        expect(entry.getVersion()).toBe(0);
    });
});

// ─── PassThroughMergePolicy ───────────────────────────────────────────────────

describe('PassThroughMergePolicy', () => {
    const policy = new PassThroughMergePolicy();

    test('getName returns PassThroughMergePolicy', () => {
        expect(policy.getName()).toBe('PassThroughMergePolicy');
    });

    test('always returns the merging value', () => {
        const merging = makeEntry('k', 'merging');
        const existing = makeEntry('k', 'existing');
        expect(policy.merge(merging, existing)).toBe(merging);
    });

    test('returns merging value when no existing', () => {
        const merging = makeEntry('k', 'merging');
        expect(policy.merge(merging, null)).toBe(merging);
    });
});

// ─── PutIfAbsentMergePolicy ───────────────────────────────────────────────────

describe('PutIfAbsentMergePolicy', () => {
    const policy = new PutIfAbsentMergePolicy();

    test('getName returns PutIfAbsentMergePolicy', () => {
        expect(policy.getName()).toBe('PutIfAbsentMergePolicy');
    });

    test('keeps existing value when present', () => {
        const merging = makeEntry('k', 'merging');
        const existing = makeEntry('k', 'existing');
        expect(policy.merge(merging, existing)).toBe(existing);
    });

    test('uses merging value when no existing', () => {
        const merging = makeEntry('k', 'merging');
        expect(policy.merge(merging, null)).toBe(merging);
    });
});

// ─── HigherHitsMergePolicy ────────────────────────────────────────────────────

describe('HigherHitsMergePolicy', () => {
    const policy = new HigherHitsMergePolicy();

    test('getName returns HigherHitsMergePolicy', () => {
        expect(policy.getName()).toBe('HigherHitsMergePolicy');
    });

    test('keeps merging when it has higher hits', () => {
        const merging = makeEntry('k', 'merging', { hits: 10 });
        const existing = makeEntry('k', 'existing', { hits: 5 });
        expect(policy.merge(merging, existing)).toBe(merging);
    });

    test('keeps existing when it has higher hits', () => {
        const merging = makeEntry('k', 'merging', { hits: 3 });
        const existing = makeEntry('k', 'existing', { hits: 7 });
        expect(policy.merge(merging, existing)).toBe(existing);
    });

    test('keeps merging on equal hits (merging wins tiebreak)', () => {
        const merging = makeEntry('k', 'merging', { hits: 5 });
        const existing = makeEntry('k', 'existing', { hits: 5 });
        expect(policy.merge(merging, existing)).toBe(merging);
    });

    test('uses merging value when no existing', () => {
        const merging = makeEntry('k', 'merging', { hits: 1 });
        expect(policy.merge(merging, null)).toBe(merging);
    });
});

// ─── LatestUpdateMergePolicy ──────────────────────────────────────────────────

describe('LatestUpdateMergePolicy', () => {
    const policy = new LatestUpdateMergePolicy();

    test('getName returns LatestUpdateMergePolicy', () => {
        expect(policy.getName()).toBe('LatestUpdateMergePolicy');
    });

    test('keeps merging when it has later update time', () => {
        const merging = makeEntry('k', 'merging', { lastUpdateTime: 1000 });
        const existing = makeEntry('k', 'existing', { lastUpdateTime: 500 });
        expect(policy.merge(merging, existing)).toBe(merging);
    });

    test('keeps existing when it has later update time', () => {
        const merging = makeEntry('k', 'merging', { lastUpdateTime: 500 });
        const existing = makeEntry('k', 'existing', { lastUpdateTime: 1000 });
        expect(policy.merge(merging, existing)).toBe(existing);
    });

    test('uses merging value when no existing', () => {
        const merging = makeEntry('k', 'merging', { lastUpdateTime: 100 });
        expect(policy.merge(merging, null)).toBe(merging);
    });
});

// ─── LatestAccessMergePolicy ──────────────────────────────────────────────────

describe('LatestAccessMergePolicy', () => {
    const policy = new LatestAccessMergePolicy();

    test('getName returns LatestAccessMergePolicy', () => {
        expect(policy.getName()).toBe('LatestAccessMergePolicy');
    });

    test('keeps merging when it has later access time', () => {
        const merging = makeEntry('k', 'merging', { lastAccessTime: 2000 });
        const existing = makeEntry('k', 'existing', { lastAccessTime: 1000 });
        expect(policy.merge(merging, existing)).toBe(merging);
    });

    test('keeps existing when it has later access time', () => {
        const merging = makeEntry('k', 'merging', { lastAccessTime: 1000 });
        const existing = makeEntry('k', 'existing', { lastAccessTime: 2000 });
        expect(policy.merge(merging, existing)).toBe(existing);
    });

    test('uses merging value when no existing', () => {
        const merging = makeEntry('k', 'merging', { lastAccessTime: 100 });
        expect(policy.merge(merging, null)).toBe(merging);
    });
});

// ─── ExpirationTimeMergePolicy ────────────────────────────────────────────────

describe('ExpirationTimeMergePolicy', () => {
    const policy = new ExpirationTimeMergePolicy();

    test('getName returns ExpirationTimeMergePolicy', () => {
        expect(policy.getName()).toBe('ExpirationTimeMergePolicy');
    });

    test('keeps merging when it expires later', () => {
        const merging = makeEntry('k', 'merging', { expirationTime: 9000 });
        const existing = makeEntry('k', 'existing', { expirationTime: 5000 });
        expect(policy.merge(merging, existing)).toBe(merging);
    });

    test('keeps existing when it expires later', () => {
        const merging = makeEntry('k', 'merging', { expirationTime: 5000 });
        const existing = makeEntry('k', 'existing', { expirationTime: 9000 });
        expect(policy.merge(merging, existing)).toBe(existing);
    });

    test('uses merging value when no existing', () => {
        const merging = makeEntry('k', 'merging', { expirationTime: 100 });
        expect(policy.merge(merging, null)).toBe(merging);
    });
});

// ─── DiscardMergePolicy ───────────────────────────────────────────────────────

describe('DiscardMergePolicy', () => {
    const policy = new DiscardMergePolicy();

    test('getName returns DiscardMergePolicy', () => {
        expect(policy.getName()).toBe('DiscardMergePolicy');
    });

    test('always discards merging value and returns existing', () => {
        const merging = makeEntry('k', 'merging');
        const existing = makeEntry('k', 'existing');
        expect(policy.merge(merging, existing)).toBe(existing);
    });

    test('returns null when no existing (discard with no existing)', () => {
        const merging = makeEntry('k', 'merging');
        expect(policy.merge(merging, null)).toBeNull();
    });
});

// ─── HyperLogLogMergePolicy ───────────────────────────────────────────────────

describe('HyperLogLogMergePolicy', () => {
    const policy = new HyperLogLogMergePolicy();

    test('getName returns HyperLogLogMergePolicy', () => {
        expect(policy.getName()).toBe('HyperLogLogMergePolicy');
    });

    test('returns merging value when no existing', () => {
        const merging = makeEntry('k', 'merging');
        expect(policy.merge(merging, null)).toBe(merging);
    });

    test('returns merging value (pass-through fallback for non-HLL)', () => {
        const merging = makeEntry('k', 'merging');
        const existing = makeEntry('k', 'existing');
        expect(policy.merge(merging, existing)).toBe(merging);
    });
});

// ─── MergePolicyProvider ──────────────────────────────────────────────────────

describe('MergePolicyProvider', () => {
    const provider = new MergePolicyProvider();

    test('returns all 8 available policies', () => {
        const policies = provider.getAvailablePolicies();
        expect(policies).toHaveLength(8);
        expect(policies).toContain('PassThroughMergePolicy');
        expect(policies).toContain('PutIfAbsentMergePolicy');
        expect(policies).toContain('HigherHitsMergePolicy');
        expect(policies).toContain('LatestUpdateMergePolicy');
        expect(policies).toContain('LatestAccessMergePolicy');
        expect(policies).toContain('ExpirationTimeMergePolicy');
        expect(policies).toContain('DiscardMergePolicy');
        expect(policies).toContain('HyperLogLogMergePolicy');
    });

    test('returns correct policy instance by name', () => {
        expect(provider.getMergePolicy('PassThroughMergePolicy')).toBeInstanceOf(PassThroughMergePolicy);
        expect(provider.getMergePolicy('PutIfAbsentMergePolicy')).toBeInstanceOf(PutIfAbsentMergePolicy);
        expect(provider.getMergePolicy('HigherHitsMergePolicy')).toBeInstanceOf(HigherHitsMergePolicy);
        expect(provider.getMergePolicy('DiscardMergePolicy')).toBeInstanceOf(DiscardMergePolicy);
    });

    test('throws on unknown policy name', () => {
        expect(() => provider.getMergePolicy('BogusPolicy')).toThrow('Unknown merge policy: BogusPolicy');
    });

    test('returns a new instance per call (stateless policy)', () => {
        const p1 = provider.getMergePolicy('PassThroughMergePolicy');
        const p2 = provider.getMergePolicy('PassThroughMergePolicy');
        expect(p1).not.toBe(p2);
    });
});

// ─── SplitBrainMergeHandler ───────────────────────────────────────────────────

describe('SplitBrainMergeHandler', () => {
    function buildSimpleStore(
        entries: Map<string, string>,
    ): { store: MergeableMapStore; underlying: Map<string, string> } {
        const map = new Map(entries);

        const store: MergeableMapStore = {
            getAllEntries(mapName: string) {
                if (mapName !== 'myMap') return [][Symbol.iterator]() as IterableIterator<readonly [Data, Data]>;
                return (function* () {
                    for (const [k, v] of map) {
                        yield [makeData(k), makeData(v)] as const;
                    }
                })();
            },
            getRecordStore(mapName: string, _partitionId: number) {
                if (mapName !== 'myMap') return null;
                return {
                    get(key: Data): Data | null {
                        const k = _serializer.toObject<string>(key)!;
                        const v = map.get(k);
                        return v !== undefined ? makeData(v) : null;
                    },
                    put(key: Data, value: Data): Data | null {
                        const k = _serializer.toObject<string>(key)!;
                        const v = _serializer.toObject<string>(value)!;
                        const old = map.get(k) ?? null;
                        map.set(k, v);
                        return old !== null ? makeData(old) : null;
                    },
                    remove(key: Data): Data | null {
                        const k = _serializer.toObject<string>(key)!;
                        const old = map.get(k) ?? null;
                        map.delete(k);
                        return old !== null ? makeData(old) : null;
                    },
                    entries() {
                        return (function* () {
                            for (const [k, v] of map) {
                                yield [makeData(k), makeData(v)] as const;
                            }
                        })();
                    },
                };
            },
            getMapNames(): string[] {
                return ['myMap'];
            },
        };

        return { store, underlying: map };
    }

    test('mergeMap with PassThrough overwrites existing entries', () => {
        const handler = new SplitBrainMergeHandler();
        const { store: existingStore, underlying } = buildSimpleStore(new Map([['key1', 'existing']]));

        const mergingEntries = (function* () {
            yield [makeData('key1'), makeData('merging')] as const;
        })();

        const result = handler.mergeMap('myMap', 'PassThroughMergePolicy', mergingEntries, existingStore, () => 0);

        expect(result.totalEntries).toBe(1);
        expect(result.mergedCount).toBe(1);
        expect(result.discardedCount).toBe(0);
        expect(underlying.get('key1')).toBe('merging');
    });

    test('mergeMap with PutIfAbsent keeps existing entries', () => {
        const handler = new SplitBrainMergeHandler();
        const { store: existingStore, underlying } = buildSimpleStore(new Map([['key1', 'existing']]));

        const mergingEntries = (function* () {
            yield [makeData('key1'), makeData('merging')] as const;
        })();

        const result = handler.mergeMap('myMap', 'PutIfAbsentMergePolicy', mergingEntries, existingStore, () => 0);

        expect(result.totalEntries).toBe(1);
        expect(result.mergedCount).toBe(0);
        expect(result.discardedCount).toBe(1);
        expect(underlying.get('key1')).toBe('existing'); // unchanged
    });

    test('mergeMap with PutIfAbsent inserts new key', () => {
        const handler = new SplitBrainMergeHandler();
        const { store: existingStore, underlying } = buildSimpleStore(new Map());

        const mergingEntries = (function* () {
            yield [makeData('newKey'), makeData('newValue')] as const;
        })();

        const result = handler.mergeMap('myMap', 'PutIfAbsentMergePolicy', mergingEntries, existingStore, () => 0);

        expect(result.mergedCount).toBe(1);
        expect(underlying.get('newKey')).toBe('newValue');
    });

    test('mergeMap with Discard removes merging entry from existing', () => {
        const handler = new SplitBrainMergeHandler();
        // Discard returns existing (null when key absent) => null => remove
        const { store: existingStore, underlying } = buildSimpleStore(new Map());

        const mergingEntries = (function* () {
            yield [makeData('key1'), makeData('value1')] as const;
        })();

        const result = handler.mergeMap('myMap', 'DiscardMergePolicy', mergingEntries, existingStore, () => 0);

        expect(result.discardedCount).toBe(1);
        expect(underlying.has('key1')).toBe(false);
    });

    test('getAvailablePolicies returns 8 policies', () => {
        const handler = new SplitBrainMergeHandler();
        expect(handler.getAvailablePolicies()).toHaveLength(8);
    });
});

// ─── SplitBrainDetector with merge lifecycle ──────────────────────────────────

describe('SplitBrainDetector lifecycle events', () => {
    test('healSplitBrain emits MERGING then MERGED and clears read-only mode', () => {
        const detector = new SplitBrainDetector(3);
        const lifecycleService = new HeliosLifecycleService();

        const events: LifecycleState[] = [];
        lifecycleService.addLifecycleListener({
            stateChanged: (event) => events.push(event.getState()),
        });

        detector.setLifecycleService(lifecycleService);

        // Force read-only mode
        detector.onMemberUnreachable('member-1');
        detector.onMemberUnreachable('member-2');
        expect(detector.isReadOnly()).toBe(true);

        // Heal without merge context
        detector.healSplitBrain(null);

        expect(detector.isReadOnly()).toBe(false);
        expect(events).toEqual([LifecycleState.MERGING, LifecycleState.MERGED]);
    });

    test('healSplitBrain calls mergeAll on the merge handler', () => {
        const detector = new SplitBrainDetector(2);
        const lifecycleService = new HeliosLifecycleService();
        detector.setLifecycleService(lifecycleService);

        const handler = new SplitBrainMergeHandler();
        detector.setMergeHandler(handler);

        // Build a simple store for merge
        const existingMap = new Map<string, string>([['key1', 'existingValue']]);
        const mergingMap = new Map<string, string>([['key1', 'mergingValue'], ['key2', 'newValue']]);

        function buildStore(dataMap: Map<string, string>): MergeableMapStore {
            return {
                getAllEntries(mapName: string) {
                    if (mapName !== 'testMap') return [][Symbol.iterator]() as IterableIterator<readonly [Data, Data]>;
                    return (function* () {
                        for (const [k, v] of dataMap) {
                            yield [makeData(k), makeData(v)] as const;
                        }
                    })();
                },
                getRecordStore(mapName: string, _partitionId: number) {
                    if (mapName !== 'testMap') return null;
                    return {
                        get(key: Data): Data | null {
                            const k = _serializer.toObject<string>(key)!;
                            const v = dataMap.get(k);
                            return v !== undefined ? makeData(v) : null;
                        },
                        put(key: Data, value: Data): Data | null {
                            const k = _serializer.toObject<string>(key)!;
                            const v = _serializer.toObject<string>(value)!;
                            dataMap.set(k, v);
                            return null;
                        },
                        remove(key: Data): Data | null {
                            const k = _serializer.toObject<string>(key)!;
                            dataMap.delete(k);
                            return null;
                        },
                        entries() {
                            return (function* () {
                                for (const [k, v] of dataMap) {
                                    yield [makeData(k), makeData(v)] as const;
                                }
                            })();
                        },
                    };
                },
                getMapNames(): string[] {
                    return ['testMap'];
                },
            };
        }

        const events: LifecycleState[] = [];
        lifecycleService.addLifecycleListener({
            stateChanged: (event) => events.push(event.getState()),
        });

        detector.healSplitBrain({
            mergingStore: buildStore(mergingMap),
            existingStore: buildStore(existingMap),
            partitionResolver: () => 0,
            policyNameResolver: () => 'PassThroughMergePolicy',
        });

        // PassThrough: merging values overwrite existing
        expect(existingMap.get('key1')).toBe('mergingValue');
        expect(existingMap.get('key2')).toBe('newValue');
        expect(events).toEqual([LifecycleState.MERGING, LifecycleState.MERGED]);
        expect(detector.isReadOnly()).toBe(false);
    });
});
