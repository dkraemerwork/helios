/**
 * Port of AbstractInvalidatorTest + BatchInvalidatorTest + NonStopInvalidatorTest.
 *
 * Tests null-check behavior of Invalidator implementations.
 * Uses stub NodeEngine to avoid needing a full cluster.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { BatchInvalidator } from '@helios/internal/nearcache/impl/invalidation/BatchInvalidator';
import { NonStopInvalidator } from '@helios/internal/nearcache/impl/invalidation/NonStopInvalidator';
import type { Invalidator } from '@helios/internal/nearcache/impl/invalidation/Invalidator';
import type { BatchInvalidatorNodeEngine } from '@helios/internal/nearcache/impl/invalidation/BatchInvalidator';
import type { InvalidatorNodeEngine } from '@helios/internal/nearcache/impl/invalidation/Invalidator';
import type { Data } from '@helios/internal/serialization/Data';

// Minimal stub for BatchInvalidatorNodeEngine (no real cluster needed)
function makeBatchNodeEngine(): BatchInvalidatorNodeEngine {
    const partitionService = {
        getPartitionCount: () => 271,
        getPartitionId: (_key: unknown) => 0,
    };
    const eventService = {
        getRegistrations: (_sn: string, _name: string) => [],
        publishEvent: () => {},
    };
    const logger = {
        finest: () => {}, isFinestEnabled: () => false,
        fine: () => {}, isFineEnabled: () => false,
        warning: () => {},
    };
    const lifecycleService = {
        addLifecycleListener: (_fn: unknown) => 'listener-id-stub',
        removeLifecycleListener: (_id: string) => {},
    };
    const heliosInstance = {
        getLifecycleService: () => lifecycleService,
    };
    const executionService = {
        scheduleWithRepetition: (_name: string, _task: unknown, _init: number, _period: number) => {},
        shutdownExecutor: (_name: string) => {},
    };
    return {
        getLogger: (_cls: unknown) => logger,
        getPartitionService: () => partitionService,
        getEventService: () => eventService,
        getHeliosInstance: () => heliosInstance,
        getExecutionService: () => executionService,
    } as BatchInvalidatorNodeEngine;
}

// Minimal stub for InvalidatorNodeEngine
function makeNodeEngine(): InvalidatorNodeEngine {
    const partitionService = {
        getPartitionCount: () => 271,
        getPartitionId: (_key: unknown) => 0,
    };
    const eventService = {
        getRegistrations: (_sn: string, _name: string) => [],
        publishEvent: () => {},
    };
    const logger = {
        finest: () => {}, isFinestEnabled: () => false,
    };
    return {
        getLogger: (_cls: unknown) => logger,
        getPartitionService: () => partitionService,
        getEventService: () => eventService,
    } as InvalidatorNodeEngine;
}

function makeKey(): Data {
    return { toByteArray: () => Buffer.alloc(8), totalSize: () => 8 } as unknown as Data;
}

const TRUE_FILTER = (_reg: unknown) => true;
const SOURCE_UUID = 'source-uuid-abc';
const MAP_NAME = 'testMap';

describe('BatchInvalidatorTest', () => {
    let invalidator: Invalidator;

    beforeEach(() => {
        invalidator = new BatchInvalidator(MAP_NAME, 100, 10, TRUE_FILTER, makeBatchNodeEngine());
    });

    it('testInvalidate_withInvalidKey', () => {
        expect(() => invalidator.invalidateKey(null as unknown as Data, MAP_NAME, SOURCE_UUID)).toThrow();
    });

    it('testInvalidate_withInvalidMapName', () => {
        const key = makeKey();
        expect(() => invalidator.invalidateKey(key, null as unknown as string, SOURCE_UUID)).toThrow();
    });

    it('testInvalidate_withInvalidSourceUuid', () => {
        const key = makeKey();
        expect(() => invalidator.invalidateKey(key, MAP_NAME, null as unknown as string)).toThrow();
    });

    it('testInvalidateAllKeys_withInvalidMapName', () => {
        expect(() => invalidator.invalidateAllKeys(null as unknown as string, SOURCE_UUID)).toThrow();
    });

    it('testInvalidateAllKeys_withInvalidSourceUuid', () => {
        expect(() => invalidator.invalidateAllKeys(MAP_NAME, null as unknown as string)).toThrow();
    });
});

describe('NonStopInvalidatorTest', () => {
    let invalidator: Invalidator;

    beforeEach(() => {
        invalidator = new NonStopInvalidator(MAP_NAME, TRUE_FILTER, makeNodeEngine());
    });

    it('testInvalidate_withInvalidKey', () => {
        expect(() => invalidator.invalidateKey(null as unknown as Data, MAP_NAME, SOURCE_UUID)).toThrow();
    });

    it('testInvalidate_withInvalidMapName', () => {
        const key = makeKey();
        expect(() => invalidator.invalidateKey(key, null as unknown as string, SOURCE_UUID)).toThrow();
    });

    it('testInvalidate_withInvalidSourceUuid', () => {
        const key = makeKey();
        expect(() => invalidator.invalidateKey(key, MAP_NAME, null as unknown as string)).toThrow();
    });

    it('testInvalidateAllKeys_withInvalidMapName', () => {
        expect(() => invalidator.invalidateAllKeys(null as unknown as string, SOURCE_UUID)).toThrow();
    });

    it('testInvalidateAllKeys_withInvalidSourceUuid', () => {
        expect(() => invalidator.invalidateAllKeys(MAP_NAME, null as unknown as string)).toThrow();
    });
});
