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

function createMember(overrides: Partial<MonitorPayload['members'][number]>): MonitorPayload['members'][number] {
  return {
    address: '10.0.0.5:5701',
    restPort: 8080,
    restAddress: 'http://public-a.example:8080',
    monitorCapable: true,
    adminCapable: true,
    liteMember: false,
    localMember: false,
    uuid: 'member-a',
    memberVersion: '1.0.0',
    ...overrides,
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

    service.autoDiscoverMembers('stress', createPayload(createMember({
      address: '10.0.0.6:5701',
      restPort: 18082,
      restAddress: 'http://public-b.example:18082',
      uuid: 'member-b',
    })));

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

    service.autoDiscoverMembers('stress', createPayload(createMember({
      address: '10.0.0.6:5701',
      restPort: 0,
      restAddress: null,
      monitorCapable: false,
      adminCapable: false,
      uuid: 'member-b',
    })));

    expect(connectCalls).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('auto-discovery ignores non-monitor-capable members even if they appear in membership', () => {
    const service = Object.create(ClusterConnectorService.prototype) as any;
    const connectCalls: Array<{ memberAddr: string; restUrl: string }> = [];

    service.clusterConfigs = new Map([['stress', createClusterConfig()]]);
    service.sseClients = new Map([['stress', new Map()]]);
    service.logger = { log() {}, warn() {} };
    service.connectMember = (_clusterId: string, memberAddr: string, restUrl: string) => {
      connectCalls.push({ memberAddr, restUrl });
    };
    service.emitSystemEvent = () => {};

    service.autoDiscoverMembers('stress', createPayload(createMember({
      address: '127.0.0.1:15710',
      restPort: 0,
      restAddress: null,
      monitorCapable: false,
      adminCapable: false,
      uuid: 'client-member',
    })));

    expect(connectCalls).toEqual([]);
  });
});
