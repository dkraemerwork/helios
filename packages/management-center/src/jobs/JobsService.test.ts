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
      serializeVertices: (value: unknown) => JSON.stringify(value),
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
          executionStartTime: 123,
          completionTime: null,
          lightJob: true,
          supportsRestart: false,
        },
      ],
    });
    expect(JSON.parse((emitted[0]?.payload as { jobs: Array<{ verticesJson: string }> }).jobs[0]!.verticesJson)).toEqual([]);
  });

  test('normalizes persisted topology vertices from runtime metrics', async () => {
    const service = Object.create(JobsService.prototype) as JobsService;
    const subject = service as any;
    let inserted: unknown[] = [];

    subject.connectorService = {
      fetchJobs: async () => ({
        jobs: [
          {
            id: 'job-2',
            name: 'Topology Job',
            status: 'RUNNING',
            executionStartTime: 500,
            completionTime: null,
            lightJob: false,
            supportsCancel: true,
            supportsRestart: true,
            vertices: [{ name: 'source', type: 'source' }, { name: 'sink', type: 'sink' }],
            edges: [{ from: 'source', to: 'sink', edgeType: 'LOCAL' }],
            metrics: {
              vertices: {
                source: { status: 'RUNNING', parallelism: 2, itemsIn: 0, itemsOut: 7 },
                sink: { status: 'RUNNING', parallelism: 2, itemsIn: 7, itemsOut: 0 },
              },
            },
          },
        ],
      }),
    };
    subject.topologySerializer = {
      serializeVertices: (value: unknown) => JSON.stringify(value),
      serializeEdges: (value: unknown) => JSON.stringify(value),
    };
    subject.eventEmitter = { emit: () => {} };
    subject.lastKnownStatus = new Map();
    subject.insertSnapshots = async (snapshots: unknown[]) => {
      inserted = snapshots;
    };

    await service.fetchAndStoreJobs('stress');

    expect(inserted).toHaveLength(1);
    expect(JSON.parse((inserted[0] as { verticesJson: string }).verticesJson)).toEqual([
      {
        id: 'source',
        name: 'source',
        type: 'source',
        status: 'RUNNING',
        parallelism: 2,
        processedItems: 0,
        emittedItems: 7,
      },
      {
        id: 'sink',
        name: 'sink',
        type: 'sink',
        status: 'RUNNING',
        parallelism: 2,
        processedItems: 7,
        emittedItems: 0,
      },
    ]);
  });

  test('preserves exported runtime fields without fabricating terminal timestamps', async () => {
    const service = Object.create(JobsService.prototype) as JobsService;
    const subject = service as any;
    let inserted: unknown[] = [];

    subject.connectorService = {
      fetchJobs: async () => ({
        jobs: [
          {
            id: 'job-3',
            name: 'Light Job',
            status: 'RUNNING',
            executionStartTime: 500,
            executionCompletionTime: -1,
            lightJob: true,
            supportsCancel: true,
            supportsRestart: false,
            vertices: [{ name: 'source', type: 'source', processedItems: 0, emittedItems: 7 }],
            edges: [],
            metrics: {
              vertices: {
                source: { itemsIn: 0, itemsOut: 7 },
              },
            },
          },
        ],
      }),
    };
    subject.topologySerializer = {
      serializeVertices: (value: unknown) => JSON.stringify(value),
      serializeEdges: (value: unknown) => JSON.stringify(value),
    };
    subject.eventEmitter = { emit: () => {} };
    subject.lastKnownStatus = new Map();
    subject.insertSnapshots = async (snapshots: unknown[]) => {
      inserted = snapshots;
    };

    await service.fetchAndStoreJobs('stress');

    expect(inserted).toHaveLength(1);
    expect((inserted[0] as { completionTime: number | null }).completionTime).toBeNull();
    expect(JSON.parse((inserted[0] as { verticesJson: string }).verticesJson)).toEqual([
      {
        id: 'source',
        name: 'source',
        type: 'source',
        processedItems: 0,
        emittedItems: 7,
        parallelism: null,
      },
    ]);
  });

  test('emits an empty jobs payload when the cluster reports no jobs', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const service = Object.create(JobsService.prototype) as JobsService;
    const subject = service as any;

    subject.connectorService = {
      fetchJobs: async () => ({ jobs: [] }),
    };
    subject.topologySerializer = {
      serializeVertices: (value: unknown) => JSON.stringify(value),
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
