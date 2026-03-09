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
  });
});
