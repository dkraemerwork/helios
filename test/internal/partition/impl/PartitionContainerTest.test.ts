import { describe, it, expect, beforeEach } from 'bun:test';
import { PartitionContainer } from '@helios/internal/partition/impl/PartitionContainer';
import type { RecordStore } from '@helios/map/impl/recordstore/RecordStore';

describe('PartitionContainer', () => {
    let container: PartitionContainer;

    beforeEach(() => {
        container = new PartitionContainer(0);
    });

    it('getRecordStore returns same instance for same map name (singleton)', () => {
        const store1 = container.getRecordStore('map1');
        const store2 = container.getRecordStore('map1');
        expect(store1).toBe(store2);
    });

    it('getRecordStore returns distinct instances for different map names', () => {
        const store1 = container.getRecordStore('map1');
        const store2 = container.getRecordStore('map2');
        const store3 = container.getRecordStore('map3');
        expect(store1).not.toBe(store2);
        expect(store2).not.toBe(store3);
        expect(store1).not.toBe(store3);
    });

    it('getAllNamespaces reflects created stores', () => {
        container.getRecordStore('map1');
        container.getRecordStore('map2');
        const namespaces = container.getAllNamespaces();
        expect(namespaces).toHaveLength(2);
        expect(namespaces.sort()).toEqual(['map1', 'map2']);
    });

    it('cleanUpOnMigration clears all stores and resets state', () => {
        const oldStore = container.getRecordStore('map1');
        container.getRecordStore('map2');
        container.cleanUpOnMigration();

        expect(container.getAllNamespaces()).toHaveLength(0);

        // New call returns a fresh instance, not the old one
        const newStore = container.getRecordStore('map1');
        expect(newStore).not.toBe(oldStore);
    });

    it('cleanUpOnMigration is idempotent', () => {
        container.getRecordStore('map1');
        container.cleanUpOnMigration();
        container.cleanUpOnMigration();
        expect(container.getAllNamespaces()).toHaveLength(0);
    });

    it('getAllNamespaces returns empty array when no stores exist', () => {
        expect(container.getAllNamespaces()).toEqual([]);
    });

    it('partitionId is accessible', () => {
        const c = new PartitionContainer(42);
        expect(c.partitionId).toBe(42);
    });
});
