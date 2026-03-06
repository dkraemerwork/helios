/**
 * Port of com.hazelcast.internal.partition.impl.NameSpaceUtilTest
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { DistributedObjectNamespace } from '@zenystx/core/internal/services/DistributedObjectNamespace';
import { NameSpaceUtil } from '@zenystx/core/internal/partition/impl/NameSpaceUtil';
import type { ServiceNamespace } from '@zenystx/core/internal/services/ServiceNamespace';

const SERVICE_NAME = 'service';

describe('NameSpaceUtilTest', () => {
    let containers: Map<number, number>;

    beforeEach(() => {
        containers = new Map<number, number>();
        for (let i = 0; i < 10; i++) {
            containers.set(i, i);
        }
    });

    it('testGetAllNamespaces_whenAllMatch', () => {
        const namespaces = NameSpaceUtil.getAllNamespaces(
            containers,
            () => true,
            (container) => new DistributedObjectNamespace(SERVICE_NAME, container.toString()),
        );
        expect(namespaces.size).toBe(containers.size);
    });

    it('testGetAllNamespaces_whenOneMatches', () => {
        const namespaces = NameSpaceUtil.getAllNamespaces(
            containers,
            (container) => container === 5,
            (container) => new DistributedObjectNamespace(SERVICE_NAME, container.toString()),
        );
        expect(namespaces.size).toBe(1);
    });

    it('testGetAllNamespaces_namespacesMutable', () => {
        const namespaces = NameSpaceUtil.getAllNamespaces(
            containers,
            (container) => container === 5,
            (container) => new DistributedObjectNamespace(SERVICE_NAME, container.toString()),
        );
        const namespaceToRetain = new DistributedObjectNamespace(SERVICE_NAME, '6');
        // Verify the set is mutable — retainAll equivalent: keep only matching
        for (const ns of [...namespaces]) {
            if (!(ns instanceof DistributedObjectNamespace) || !ns.equals(namespaceToRetain)) {
                namespaces.delete(ns as ServiceNamespace);
            }
        }
        expect(namespaces.size).toBe(0);
    });
});
