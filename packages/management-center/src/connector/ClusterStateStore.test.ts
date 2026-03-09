import { describe, expect, test } from 'bun:test';
import { ClusterStateStore } from './ClusterStateStore.js';
import type { MonitorPayload } from '../shared/types.js';

function createPayload(restAddress: string | null): MonitorPayload {
  return {
    instanceName: 'stress-a',
    clusterName: 'stress',
    clusterState: 'ACTIVE',
    clusterSize: 1,
    members: [
      {
        address: '10.0.0.5:5701',
        restPort: 8080,
        restAddress,
        liteMember: false,
        localMember: true,
        uuid: 'member-a',
        memberVersion: '1.0.0',
      },
    ],
    partitions: {
      partitionCount: 271,
      memberPartitions: {},
    },
    distributedObjects: [],
    samples: [],
  };
}

describe('ClusterStateStore', () => {
  test('canonicalizes bootstrap aliases onto the member tcp address', () => {
    const store = new ClusterStateStore();

    store.initCluster('stress', 'Stress');
    store.setMemberConnected('stress', '10.0.0.5', 'http://10.0.0.5:8080');
    store.updateFromPayload('stress', '10.0.0.5', createPayload('http://public-a.example:8080'));
    store.canonicalizeMemberAddress(
      'stress',
      '10.0.0.5',
      '10.0.0.5:5701',
      'http://public-a.example:8080',
    );

    const state = store.getClusterState('stress');
    expect(state).toBeDefined();
    expect(state?.members.has('10.0.0.5')).toBe(false);

    const member = state?.members.get('10.0.0.5:5701');
    expect(member?.connected).toBe(true);
    expect(member?.restAddress).toBe('http://public-a.example:8080');
    expect(member?.info?.restAddress).toBe('http://public-a.example:8080');
  });

  test('does not overwrite a known restAddress with a later null advertisement', () => {
    const store = new ClusterStateStore();

    store.initCluster('stress', 'Stress');
    store.updateFromPayload('stress', '10.0.0.5:5701', createPayload('http://public-a.example:8080'));
    store.updateFromPayload('stress', '10.0.0.5:5701', createPayload(null));

    const member = store.getClusterState('stress')?.members.get('10.0.0.5:5701');
    expect(member?.restAddress).toBe('http://public-a.example:8080');
    expect(member?.info?.restAddress).toBe('http://public-a.example:8080');
  });
});
