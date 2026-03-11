import { describe, expect, test } from 'bun:test';
import { DashboardGateway } from './DashboardGateway.js';

describe('DashboardGateway', () => {
  test('sends jobs data in the initial subscription snapshot', async () => {
    const gateway = Object.create(DashboardGateway.prototype) as DashboardGateway;
    const subject = gateway as any;
    const sent: Array<{ event: string; data: unknown }> = [];

    subject.clusterStateStore = {
      getClusterState: () => ({
        clusterId: 'stress',
        clusterName: 'Stress',
        clusterState: 'ACTIVE',
        clusterSize: 1,
        members: new Map(),
        distributedObjects: [],
        partitions: { partitionCount: 271, memberPartitions: {} },
        mapStats: {},
        queueStats: {},
        topicStats: {},
        lastUpdated: 100,
      }),
    };
    subject.jobsService = {
      getActiveJobs: async () => [
        {
          clusterId: 'stress',
          jobId: 'job-1',
          jobName: 'Stress Pipeline',
          status: 'RUNNING',
          timestamp: 123,
          executionStartTime: 100,
          completionTime: null,
          metricsJson: '{}',
          verticesJson: '[]',
          edgesJson: '[]',
        },
      ],
    };
    subject.sendToSocket = (_socket: unknown, event: string, data: unknown) => {
      sent.push({ event, data });
    };
    subject.logger = { warn: () => {} };

    await subject.sendInitialState({}, 'stress');

    expect(sent.map(entry => entry.event)).toContain('jobs:update');
    expect(sent.find(entry => entry.event === 'jobs:update')?.data).toMatchObject({
      clusterId: 'stress',
      jobs: [
        {
          jobId: 'job-1',
          status: 'RUNNING',
        },
      ],
    });
  });

  test('forwards admin action events with actor user context', () => {
    const gateway = Object.create(DashboardGateway.prototype) as DashboardGateway;
    const subject = gateway as any;
    const broadcasts: Array<{ clusterId: string; event: string; data: unknown }> = [];

    subject.broadcastToRoom = (clusterId: string, event: string, data: unknown) => {
      broadcasts.push({ clusterId, event, data });
    };

    subject.onAdminActionCompleted({
      clusterId: 'stress',
      action: 'cancelJob',
      result: { success: true },
      actorUserId: 'user-1',
    });

    expect(broadcasts).toEqual([
      {
        clusterId: 'stress',
        event: 'admin:result',
        data: {
          clusterId: 'stress',
          action: 'cancelJob',
          result: { success: true },
          actorUserId: 'user-1',
        },
      },
    ]);
  });
});
