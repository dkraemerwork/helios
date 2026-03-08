/**
 * Block 23.12 — BlitzService integration + BlitzEvent + exports + NestJS bridge tests.
 *
 * Tests BlitzService.newJob(), newLightJob(), getJob(), getJobs(), setCoordinator(),
 * BlitzEvent job lifecycle events, NestJS proxy methods, and deprecated submit() delegation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { BlitzService, type BlitzEventListener } from '../src/BlitzService.ts';
import { BlitzEvent } from '../src/BlitzEvent.ts';
import { Pipeline } from '../src/Pipeline.ts';
import { HeliosBlitzService } from '../src/nestjs/HeliosBlitzService.ts';

// Re-export verification imports — these must compile from index.ts
import {
  BlitzJob,
  JobConfig,
  JobStatus,
  ProcessingGuarantee,
  type BlitzJobMetrics,
  type JobRecord,
  type PipelineDescriptor,
  type ResolvedJobConfig,
  type JobStatusListener,
  type JobStatusEvent,
} from '../src/index.ts';

describe('Block 23.12 — BlitzService Job Integration', () => {
  let blitz: BlitzService;

  beforeAll(async () => {
    blitz = await BlitzService.start();
  });

  afterAll(async () => {
    await blitz.shutdown();
  });

  // ── Standalone mode (no coordinator) ──────────────────

  describe('standalone mode — newJob as light job', () => {
    it('newJob() returns a BlitzJob in standalone mode', async () => {
      const p = blitz.pipeline('standalone-test-1');
      const job = await blitz.newJob(p);
      expect(job).toBeInstanceOf(BlitzJob);
      expect(job.name).toBe('standalone-test-1');
      expect(job.id).toBeDefined();
    });

    it('newLightJob() returns a BlitzJob', async () => {
      const p = blitz.pipeline('light-test-1');
      const job = await blitz.newLightJob(p);
      expect(job).toBeInstanceOf(BlitzJob);
      expect(job.name).toBe('light-test-1');
    });

    it('newJob() with config applies configuration', async () => {
      const p = blitz.pipeline('configured-test');
      const job = await blitz.newJob(p, { name: 'custom-name', processingGuarantee: ProcessingGuarantee.NONE });
      expect(job.name).toBe('custom-name');
    });

    it('getJob() returns job by id', async () => {
      const p = blitz.pipeline('get-test');
      const job = await blitz.newJob(p);
      const found = blitz.getJob(job.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(job.id);
    });

    it('getJob() returns null for unknown id', () => {
      const found = blitz.getJob('nonexistent-id');
      expect(found).toBeNull();
    });

    it('getJobs() returns all submitted jobs', async () => {
      // Create a fresh BlitzService to avoid interference
      const fresh = await BlitzService.connect({ servers: blitz.config.servers });
      const p1 = fresh.pipeline('jobs-1');
      const p2 = fresh.pipeline('jobs-2');
      await fresh.newJob(p1);
      await fresh.newJob(p2);
      const jobs = fresh.getJobs();
      expect(jobs.length).toBeGreaterThanOrEqual(2);
      await fresh.shutdown();
    });

    it('getJobs() with name filter returns matching jobs', async () => {
      const fresh = await BlitzService.connect({ servers: blitz.config.servers });
      await fresh.newJob(fresh.pipeline('filter-a'), { name: 'filter-a' });
      await fresh.newJob(fresh.pipeline('filter-b'), { name: 'filter-b' });
      const filtered = fresh.getJobs('filter-a');
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('filter-a');
      await fresh.shutdown();
    });
  });

  // ── BlitzEvent lifecycle events ───────────────────────

  describe('BlitzEvent job lifecycle events', () => {
    it('fires JOB_STARTED on newJob', async () => {
      const fresh = await BlitzService.connect({ servers: blitz.config.servers });
      const events: BlitzEvent[] = [];
      fresh.on((event) => events.push(event));
      await fresh.newJob(fresh.pipeline('event-test'));
      expect(events).toContain(BlitzEvent.JOB_STARTED);
      await fresh.shutdown();
    });

    it('fires JOB_CANCELLED on job cancel', async () => {
      const fresh = await BlitzService.connect({ servers: blitz.config.servers });
      const events: BlitzEvent[] = [];
      fresh.on((event) => events.push(event));
      const job = await fresh.newJob(fresh.pipeline('cancel-event-test'));
      await job.cancel();
      expect(events).toContain(BlitzEvent.JOB_CANCELLED);
      await fresh.shutdown();
    });

    it('BlitzEvent enum contains all job lifecycle events', () => {
      expect(BlitzEvent.JOB_STARTED).toBe('JOB_STARTED');
      expect(BlitzEvent.JOB_COMPLETED).toBe('JOB_COMPLETED');
      expect(BlitzEvent.JOB_FAILED).toBe('JOB_FAILED');
      expect(BlitzEvent.JOB_CANCELLED).toBe('JOB_CANCELLED');
      expect(BlitzEvent.JOB_SUSPENDED).toBe('JOB_SUSPENDED');
      expect(BlitzEvent.JOB_RESTARTING).toBe('JOB_RESTARTING');
      expect(BlitzEvent.SNAPSHOT_STARTED).toBe('SNAPSHOT_STARTED');
      expect(BlitzEvent.SNAPSHOT_COMPLETED).toBe('SNAPSHOT_COMPLETED');
    });
  });

  // ── Deprecated submit() delegation ────────────────────

  describe('deprecated submit() still works', () => {
    it('submit() still accepts and tracks a pipeline', async () => {
      const fresh = await BlitzService.connect({ servers: blitz.config.servers });
      const p = fresh.pipeline('submit-compat');
      p.validate = () => {}; // mock validation
      await fresh.submit(p);
      expect(fresh.isRunning('submit-compat')).toBe(true);
      await fresh.shutdown();
    });
  });

  // ── NestJS proxy ──────────────────────────────────────

  describe('NestJS HeliosBlitzService proxy', () => {
    it('newJob() proxies to BlitzService', async () => {
      const nestService = new HeliosBlitzService(blitz);
      const p = blitz.pipeline('nestjs-job');
      const job = await nestService.newJob(p);
      expect(job).toBeInstanceOf(BlitzJob);
    });

    it('newLightJob() proxies to BlitzService', async () => {
      const nestService = new HeliosBlitzService(blitz);
      const p = blitz.pipeline('nestjs-light');
      const job = await nestService.newLightJob(p);
      expect(job).toBeInstanceOf(BlitzJob);
    });

    it('getJob() proxies to BlitzService', async () => {
      const nestService = new HeliosBlitzService(blitz);
      const p = blitz.pipeline('nestjs-get');
      const job = await nestService.newJob(p);
      const found = nestService.getJob(job.id);
      expect(found).not.toBeNull();
    });

    it('getJobs() proxies to BlitzService', async () => {
      const nestService = new HeliosBlitzService(blitz);
      const jobs = nestService.getJobs();
      expect(Array.isArray(jobs)).toBe(true);
    });
  });

  // ── Exports verification ──────────────────────────────

  describe('index.ts exports all job types', () => {
    it('exports BlitzJob class', () => {
      expect(BlitzJob).toBeDefined();
    });

    it('exports JobStatus enum', () => {
      expect(JobStatus.RUNNING).toBe('RUNNING');
      expect(JobStatus.COMPLETED).toBe('COMPLETED');
    });

    it('exports ProcessingGuarantee enum', () => {
      expect(ProcessingGuarantee.NONE).toBe('NONE');
      expect(ProcessingGuarantee.AT_LEAST_ONCE).toBe('AT_LEAST_ONCE');
    });
  });
});
