import { describe, expect, test } from 'bun:test';
import { JobsService } from './JobsService.js';

describe('JobsService', () => {
  test('emits the normalized snapshots on jobs.received', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const service = Object.create(JobsService.prototype) as JobsService;
    const subject = service as any;

    subject.connectorService = {
      fetchJobs: async () => ({
        jobs: [
          {
            id: 'job-1',
            name: 'Stress Pipeline',
            status: 'RUNNING',
            executionStartTime: 123,
            completionTime: null,
            lightJob: true,
            supportsCancel: true,
            supportsRestart: false,
          },
        ],
      }),
    };
    subject.topologySerializer = {
      serializeVertices: () => '[]',
      serializeEdges: () => '[]',
    };
    subject.eventEmitter = {
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
    };
    subject.lastKnownStatus = new Map();
    subject.insertSnapshots = async () => {};

    await service.fetchAndStoreJobs('stress');

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe('jobs.received');
    expect(emitted[0]?.payload).toMatchObject({
      clusterId: 'stress',
      jobs: [
        {
          clusterId: 'stress',
          jobId: 'job-1',
          jobName: 'Stress Pipeline',
          status: 'RUNNING',
          lightJob: true,
          supportsRestart: false,
        },
      ],
    });
  });

  test('emits an empty jobs payload when the cluster reports no jobs', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const service = Object.create(JobsService.prototype) as JobsService;
    const subject = service as any;

    subject.connectorService = {
      fetchJobs: async () => ({ jobs: [] }),
    };
    subject.topologySerializer = {
      serializeVertices: () => '[]',
      serializeEdges: () => '[]',
    };
    subject.eventEmitter = {
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
    };
    subject.lastKnownStatus = new Map([['stress:job-1', 'RUNNING']]);
    subject.insertSnapshots = async () => {
      throw new Error('should not be called');
    };

    await service.fetchAndStoreJobs('stress');

    expect(emitted).toEqual([
      {
        event: 'jobs.received',
        payload: {
          clusterId: 'stress',
          jobs: [],
        },
      },
    ]);
    expect(subject.lastKnownStatus.size).toBe(0);
  });
});
