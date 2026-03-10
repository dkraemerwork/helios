import { describe, expect, test } from 'bun:test';
import { normalizeHeliosPayload } from './normalizePayload.js';

describe('normalizeHeliosPayload', () => {
  test('preserves authoritative restAddress when present', () => {
    const payload = normalizeHeliosPayload({
      instanceName: 'stress-a',
      clusterName: 'stress',
      clusterState: 'ACTIVE',
      clusterSize: 2,
      members: [
        {
          address: '10.0.0.5:5701',
          restPort: 8080,
          restAddress: 'http://public-a.example:8080',
          monitorCapable: true,
          adminCapable: true,
          localMember: true,
          liteMember: false,
          uuid: 'member-a',
          memberVersion: '1.0.0',
        },
      ],
      distributedObjects: [],
      partitions: { partitionCount: 271, memberPartitions: {} },
      samples: [],
    });

    expect(payload.members).toHaveLength(1);
    expect(payload.members[0]?.restAddress).toBe('http://public-a.example:8080');
    expect(payload.members[0]?.restPort).toBe(8080);
    expect(payload.members[0]?.monitorCapable).toBe(true);
    expect(payload.members[0]?.adminCapable).toBe(true);
  });

  test('defaults capabilities to false when a member has no monitor endpoint advertisement', () => {
    const payload = normalizeHeliosPayload({
      instanceName: 'stress-client',
      clusterName: 'stress',
      clusterState: 'ACTIVE',
      clusterSize: 4,
      members: [
        {
          address: '127.0.0.1:15710',
          restPort: 0,
          restAddress: null,
          localMember: true,
          liteMember: false,
          uuid: 'client-member',
          memberVersion: '1.0.0',
        },
      ],
      distributedObjects: [],
      partitions: { partitionCount: 271, memberPartitions: {} },
      samples: [],
    });

    expect(payload.members[0]?.monitorCapable).toBe(false);
    expect(payload.members[0]?.adminCapable).toBe(false);
  });

  test('keeps data structure stats from JSON-safe monitor payloads', () => {
    const payload = normalizeHeliosPayload({
      instanceName: 'stress-a',
      clusterName: 'stress',
      clusterState: 'ACTIVE',
      clusterSize: 2,
      members: [],
      distributedObjects: [],
      partitions: { partitionCount: 271, memberPartitions: {} },
      samples: [],
      mapStats: {
        orders: {
          ownedEntryCount: 7,
          backupEntryCount: 2,
        },
      },
    });

    expect(payload.mapStats).toEqual({
      orders: {
        ownedEntryCount: 7,
        backupEntryCount: 2,
      },
    });
  });
});
