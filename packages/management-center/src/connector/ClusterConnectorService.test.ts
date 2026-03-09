import { describe, expect, test } from 'bun:test';
import { ClusterConnectorService } from './ClusterConnectorService.js';
import type { ClusterConfig, MonitorPayload } from '../shared/types.js';

function createClusterConfig(): ClusterConfig {
  return {
    id: 'stress',
    displayName: 'Stress',
    memberAddresses: ['10.0.0.5'],
    restPort: 8080,
    sslEnabled: false,
    autoDiscover: true,
    requestTimeoutMs: 10_000,
    stalenessWindowMs: 30_000,
  };
}

function createPayload(member: MonitorPayload['members'][number]): MonitorPayload {
  return {
    instanceName: 'stress-a',
    clusterName: 'stress',
    clusterState: 'ACTIVE',
    clusterSize: 2,
    members: [member],
    partitions: { partitionCount: 271, memberPartitions: {} },
    distributedObjects: [],
    samples: [],
  };
}

describe('ClusterConnectorService', () => {
  test('auto-discovery uses the authoritative remote restAddress', () => {
    const service = Object.create(ClusterConnectorService.prototype) as any;
    const connectCalls: Array<{ memberAddr: string; restUrl: string }> = [];

    service.clusterConfigs = new Map([['stress', createClusterConfig()]]);
    service.sseClients = new Map([['stress', new Map()]]);
    service.logger = { log() {}, warn() {} };
    service.connectMember = (_clusterId: string, memberAddr: string, restUrl: string) => {
      connectCalls.push({ memberAddr, restUrl });
    };
    service.emitSystemEvent = () => {};

    service.autoDiscoverMembers('stress', createPayload({
      address: '10.0.0.6:5701',
      restPort: 18082,
      restAddress: 'http://public-b.example:18082',
      liteMember: false,
      localMember: false,
      uuid: 'member-b',
      memberVersion: '1.0.0',
    }));

    expect(connectCalls).toEqual([
      {
        memberAddr: '10.0.0.6:5701',
        restUrl: 'http://public-b.example:18082',
      },
    ]);
  });

  test('auto-discovery does not guess config restPort without an authoritative advertisement', () => {
    const service = Object.create(ClusterConnectorService.prototype) as any;
    const connectCalls: Array<{ memberAddr: string; restUrl: string }> = [];
    const warnings: string[] = [];

    service.clusterConfigs = new Map([['stress', createClusterConfig()]]);
    service.sseClients = new Map([['stress', new Map()]]);
    service.logger = { log() {}, warn(message: string) { warnings.push(message); } };
    service.connectMember = (_clusterId: string, memberAddr: string, restUrl: string) => {
      connectCalls.push({ memberAddr, restUrl });
    };
    service.emitSystemEvent = () => {};

    service.autoDiscoverMembers('stress', createPayload({
      address: '10.0.0.6:5701',
      restPort: 0,
      restAddress: null,
      liteMember: false,
      localMember: false,
      uuid: 'member-b',
      memberVersion: '1.0.0',
    }));

    expect(connectCalls).toEqual([]);
    expect(warnings[0]).toContain('did not advertise an authoritative REST endpoint');
  });
});
