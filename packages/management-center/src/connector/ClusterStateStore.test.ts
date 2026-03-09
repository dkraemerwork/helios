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

function createClusterDataPayload(args: {
  memberAddress: string;
  distributedObjects?: MonitorPayload['distributedObjects'];
  mapStats?: Record<string, unknown>;
  queueStats?: Record<string, unknown>;
  topicStats?: Record<string, unknown>;
}): MonitorPayload {
  return {
    instanceName: args.memberAddress,
    clusterName: 'stress',
    clusterState: 'ACTIVE',
    clusterSize: 2,
    members: [
      {
        address: args.memberAddress,
        restPort: 8080,
        restAddress: `http://${args.memberAddress.replace(':5701', ':8080')}`,
        liteMember: false,
        localMember: true,
        uuid: `uuid-${args.memberAddress}`,
        memberVersion: '1.0.0',
      },
    ],
    partitions: {
      partitionCount: 271,
      memberPartitions: {},
    },
    distributedObjects: args.distributedObjects ?? [],
    mapStats: args.mapStats,
    queueStats: args.queueStats,
    topicStats: args.topicStats,
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

  test('aggregates distributed objects and stats across multiple members', () => {
    const store = new ClusterStateStore();

    store.initCluster('stress', 'Stress');
    store.updateFromPayload(
      'stress',
      '10.0.0.5:5701',
      createClusterDataPayload({
        memberAddress: '10.0.0.5:5701',
        distributedObjects: [
          { serviceName: 'hz:impl:mapService', name: 'orders' },
          { serviceName: 'hz:impl:queueService', name: 'ingest' },
        ],
        mapStats: {
          orders: {
            ownedEntryCount: 3,
            backupEntryCount: 1,
            lastAccessTime: 100,
          },
        },
        queueStats: {
          ingest: {
            ownedItemCount: 2,
          },
        },
      }),
    );
    store.updateFromPayload(
      'stress',
      '10.0.0.6:5701',
      createClusterDataPayload({
        memberAddress: '10.0.0.6:5701',
        distributedObjects: [
          { serviceName: 'hz:impl:mapService', name: 'orders' },
          { serviceName: 'hz:impl:topicService', name: 'alerts' },
        ],
        mapStats: {
          orders: {
            ownedEntryCount: 4,
            backupEntryCount: 2,
            lastAccessTime: 150,
          },
        },
        topicStats: {
          alerts: {
            publishOperationCount: 5,
          },
        },
      }),
    );

    const state = store.getClusterState('stress');
    expect(state?.distributedObjects).toEqual([
      { serviceName: 'hz:impl:topicService', name: 'alerts' },
      { serviceName: 'hz:impl:queueService', name: 'ingest' },
      { serviceName: 'hz:impl:mapService', name: 'orders' },
    ]);
    expect(state?.mapStats).toEqual({
      orders: {
        ownedEntryCount: 7,
        backupEntryCount: 3,
        lastAccessTime: 150,
      },
    });
    expect(state?.queueStats).toEqual({
      ingest: {
        ownedItemCount: 2,
      },
    });
    expect(state?.topicStats).toEqual({
      alerts: {
        publishOperationCount: 5,
      },
    });
  });

  test('keeps previously reported objects when another member payload is empty', () => {
    const store = new ClusterStateStore();

    store.initCluster('stress', 'Stress');
    store.updateFromPayload(
      'stress',
      '10.0.0.5:5701',
      createClusterDataPayload({
        memberAddress: '10.0.0.5:5701',
        distributedObjects: [{ serviceName: 'hz:impl:mapService', name: 'orders' }],
      }),
    );
    store.updateFromPayload(
      'stress',
      '10.0.0.6:5701',
      createClusterDataPayload({ memberAddress: '10.0.0.6:5701' }),
    );

    expect(store.getClusterState('stress')?.distributedObjects).toEqual([
      { serviceName: 'hz:impl:mapService', name: 'orders' },
    ]);
  });

  test('prunes disconnected member data from aggregated distributed objects and stats', () => {
    const store = new ClusterStateStore();

    store.initCluster('stress', 'Stress');
    store.setMemberConnected('stress', '10.0.0.5:5701', 'http://10.0.0.5:8080');
    store.setMemberConnected('stress', '10.0.0.6:5701', 'http://10.0.0.6:8080');
    store.updateFromPayload(
      'stress',
      '10.0.0.5:5701',
      createClusterDataPayload({
        memberAddress: '10.0.0.5:5701',
        distributedObjects: [{ serviceName: 'hz:impl:mapService', name: 'orders' }],
        mapStats: {
          orders: {
            ownedEntryCount: 3,
          },
        },
      }),
    );
    store.updateFromPayload(
      'stress',
      '10.0.0.6:5701',
      createClusterDataPayload({
        memberAddress: '10.0.0.6:5701',
        distributedObjects: [{ serviceName: 'hz:impl:queueService', name: 'ingest' }],
        queueStats: {
          ingest: {
            ownedItemCount: 2,
          },
        },
      }),
    );

    store.setMemberDisconnected('stress', '10.0.0.6:5701');

    const state = store.getClusterState('stress');
    expect(state?.distributedObjects).toEqual([
      { serviceName: 'hz:impl:mapService', name: 'orders' },
    ]);
    expect(state?.mapStats).toEqual({
      orders: {
        ownedEntryCount: 3,
      },
    });
    expect(state?.queueStats).toEqual({});
  });
});
