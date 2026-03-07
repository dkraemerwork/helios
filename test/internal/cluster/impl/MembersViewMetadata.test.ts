/**
 * Port of com.hazelcast.internal.cluster.impl.MembersViewMetadataTest
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { MembersViewMetadata } from '@zenystx/helios-core/internal/cluster/impl/MembersViewMetadata';
import { describe, expect, test } from 'bun:test';

describe('MembersViewMetadataTest', () => {
    function assertEqualAndHashCode(o1: MembersViewMetadata, o2: MembersViewMetadata): void {
        expect(o1.equals(o2)).toBe(true);
        expect(o1.hashCode()).toBe(o2.hashCode());
    }

    function assertNotEqualAndHashCode(o1: MembersViewMetadata, o2: MembersViewMetadata): void {
        expect(o1.equals(o2)).toBe(false);
        expect(o1.hashCode()).not.toBe(o2.hashCode());
    }

    test('equalsAndHashCode', () => {
        const memberUUID = '00000000-0000-0001-0000-000000000001';
        const metadata = new MembersViewMetadata(
            new Address('localhost', 1234),
            memberUUID,
            new Address('localhost', 4321),
            0,
        );

        assertEqualAndHashCode(metadata, metadata);
        expect(metadata.equals(null)).toBe(false);
        expect(metadata.equals('')).toBe(false);
        assertEqualAndHashCode(
            metadata,
            new MembersViewMetadata(new Address('localhost', 1234), memberUUID, new Address('localhost', 4321), 0),
        );

        assertNotEqualAndHashCode(
            metadata,
            new MembersViewMetadata(new Address('localhost', 999), memberUUID, new Address('localhost', 4321), 0),
        );
        assertNotEqualAndHashCode(
            metadata,
            new MembersViewMetadata(new Address('localhost', 1234), crypto.randomUUID(), new Address('localhost', 4321), 0),
        );
        assertNotEqualAndHashCode(
            metadata,
            new MembersViewMetadata(new Address('localhost', 1234), memberUUID, new Address('localhost', 999), 0),
        );
        assertNotEqualAndHashCode(
            metadata,
            new MembersViewMetadata(new Address('localhost', 1234), memberUUID, new Address('localhost', 4321), 999),
        );
    });

    test('equalsAndHashCode_withNullMasterAddress', () => {
        const memberUUID = '00000000-0000-0001-0000-000000000001';

        const metadataWithNullMaster1 = new MembersViewMetadata(new Address('localhost', 1234), memberUUID, null, 0);
        const metadataWithNullMaster2 = new MembersViewMetadata(new Address('localhost', 1234), memberUUID, null, 0);
        assertEqualAndHashCode(metadataWithNullMaster1, metadataWithNullMaster2);

        const metadataWithMaster = new MembersViewMetadata(
            new Address('localhost', 1234),
            memberUUID,
            new Address('localhost', 4321),
            0,
        );
        expect(metadataWithNullMaster1.equals(metadataWithMaster)).toBe(false);
        expect(metadataWithMaster.equals(metadataWithNullMaster1)).toBe(false);

        const metadataWithNullMaster3 = new MembersViewMetadata(new Address('localhost', 1234), memberUUID, null, 999);
        assertNotEqualAndHashCode(metadataWithNullMaster1, metadataWithNullMaster3);
    });
});
