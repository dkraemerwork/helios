import { describe, expect, test } from 'bun:test';
import { SsrStateService } from './SsrStateService.js';

describe('SsrStateService', () => {
  test('returns job detail transfer state for job detail routes', async () => {
    const service = Object.create(SsrStateService.prototype) as SsrStateService;
    const subject = service as any;

    subject.jobsService = {
      getJobById: async (clusterId: string, jobId: string) => ({
        clusterId,
        jobId,
        jobName: 'Stress Pipeline',
        status: 'RUNNING',
        timestamp: 123,
        executionStartTime: 100,
        completionTime: null,
        lightJob: false,
        supportsCancel: true,
        supportsRestart: true,
        metricsJson: '{}',
        verticesJson: '[]',
        edgesJson: '[]',
      }),
      getJobHistory: async (clusterId: string, jobId: string) => ({
        items: [{
          clusterId,
          jobId,
          jobName: 'Stress Pipeline',
          status: 'RUNNING',
          timestamp: 123,
          executionStartTime: 100,
          completionTime: null,
          lightJob: false,
          supportsCancel: true,
          supportsRestart: true,
          metricsJson: '{}',
          verticesJson: '[]',
          edgesJson: '[]',
        }],
        nextCursor: null,
      }),
    };

    const state = await service.getStateForRoute(
      '/clusters/stress/jobs/job-1',
      {
        id: 'user-1',
        email: 'user@example.com',
        displayName: 'User',
        roles: ['viewer'],
        clusterScopes: ['stress'],
        passwordHash: '',
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
      },
      ['stress'],
    );

    expect(state).toMatchObject({
      job: {
        clusterId: 'stress',
        jobId: 'job-1',
      },
      jobHistory: {
        items: [
          {
            clusterId: 'stress',
            jobId: 'job-1',
          },
        ],
        nextCursor: null,
      },
    });
  });
});
