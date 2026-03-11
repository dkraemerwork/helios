import { describe, expect, it } from 'bun:test';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';

describe('Monitor jobs provider', () => {
  it('includes light-job topology and metrics from the Blitz bridge', async () => {
    const instance = new HeliosInstanceImpl(new HeliosConfig('monitor-jobs-test'));
    instance.setBlitzService({
      isClosed: false,
      shutdown: async () => {},
      getJobs: () => [{
        id: 'job-1',
        name: 'binance-market-rollups',
        getStatus: () => 'RUNNING',
        getSubmissionTime: () => 123,
        getMetrics: async () => ({
          totalIn: 10,
          totalOut: 10,
          totalDistributedItemsIn: 0,
          totalDistributedItemsOut: 0,
          totalDistributedBytesIn: 0,
          totalDistributedBytesOut: 0,
          vertices: new Map([
            ['nats-subject:market.ticks', {
              name: 'nats-subject:market.ticks',
              type: 'source',
              itemsIn: 0,
              itemsOut: 10,
              queueSize: 0,
              queueCapacity: 0,
              latencyP50Ms: 0,
              latencyP99Ms: 0,
              latencyMaxMs: 0,
              distributedItemsIn: 0,
              distributedItemsOut: 0,
              distributedBytesIn: 0,
              distributedBytesOut: 0,
              topObservedWm: -1,
              coalescedWm: -1,
              lastForwardedWm: -1,
              lastForwardedWmLatency: -1,
            }],
          ]),
          snapshots: {
            snapshotCount: 0,
            lastSnapshotDurationMs: 0,
            lastSnapshotBytes: 0,
            lastSnapshotTimestamp: 0,
          },
          collectedAt: 456,
          executionStartTime: 123,
          executionCompletionTime: -1,
        }),
      }],
      getJobDescriptor: () => ({
        name: 'binance-market-rollups',
        parallelism: 1,
        vertices: [
          { name: 'nats-subject:market.ticks', type: 'source', fnSource: null, sourceConfig: null, sinkConfig: null },
          { name: 'map-1', type: 'operator', fnSource: '() => {}', sourceConfig: null, sinkConfig: null },
          { name: 'helios-map-sink:quote-rollups', type: 'sink', fnSource: null, sourceConfig: null, sinkConfig: null },
        ],
        edges: [
          { from: 'nats-subject:market.ticks', to: 'map-1', edgeType: 'LOCAL', subject: 'a', keyFnSource: null },
          { from: 'map-1', to: 'helios-map-sink:quote-rollups', edgeType: 'LOCAL', subject: 'b', keyFnSource: null },
        ],
      }),
      getJobMetadata: async () => ({
        lightJob: true,
        participatingMembers: ['local'],
        supportsCancel: true,
        supportsRestart: false,
        executionStartTime: 123,
        executionCompletionTime: null,
      }),
    } as never);

    const provider = (instance as unknown as {
      _createMonitorJobsProvider(): { getActiveJobs(): Promise<Array<{ vertices: unknown[]; edges: unknown[]; lightJob: boolean; supportsRestart: boolean; participatingMembers: string[]; executionStartTime: number | null; executionCompletionTime: number | null; metrics: Record<string, unknown> | null }>> };
    })._createMonitorJobsProvider();

    const jobs = await provider.getActiveJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.lightJob).toBe(true);
    expect(jobs[0]?.supportsRestart).toBe(false);
    expect(jobs[0]?.participatingMembers).toEqual(['local']);
    expect(jobs[0]?.executionStartTime).toBe(123);
    expect(jobs[0]?.executionCompletionTime).toBeNull();
    expect(jobs[0]?.vertices).toHaveLength(3);
    expect(jobs[0]?.vertices[0]).toMatchObject({
      name: 'nats-subject:market.ticks',
      status: 'UNKNOWN',
      parallelism: 1,
      processedItems: 0,
      emittedItems: 10,
    });
    expect(jobs[0]?.edges).toHaveLength(2);
    expect(jobs[0]?.metrics?.['vertices']).toBeDefined();
  });

  it('classifies distributed jobs from bridge metadata', async () => {
    const instance = new HeliosInstanceImpl(new HeliosConfig('monitor-jobs-distributed-test'));
    instance.setBlitzService({
      isClosed: false,
      shutdown: async () => {},
      getJobs: () => [{
        id: 'job-2',
        name: 'clustered-job',
        getStatus: () => 'RUNNING',
        getSubmissionTime: () => 456,
      }],
      getJobDescriptor: () => ({
        vertices: [{ name: 'source', type: 'source' }],
        edges: [],
      }),
      getJobMetadata: async () => ({
        lightJob: false,
        participatingMembers: ['member-a', 'member-b'],
        supportsCancel: true,
        supportsRestart: true,
        executionStartTime: 456,
        executionCompletionTime: null,
      }),
    } as never);

    const provider = (instance as unknown as {
      _createMonitorJobsProvider(): { getActiveJobs(): Promise<Array<{ participatingMembers: string[]; lightJob: boolean; supportsRestart: boolean }>> };
    })._createMonitorJobsProvider();

    const jobs = await provider.getActiveJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.lightJob).toBe(false);
    expect(jobs[0]?.supportsRestart).toBe(true);
    expect(jobs[0]?.participatingMembers).toEqual(['member-a', 'member-b']);
  });
});
