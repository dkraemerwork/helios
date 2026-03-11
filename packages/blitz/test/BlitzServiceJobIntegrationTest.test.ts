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
import { StringCodec } from '../src/codec/BlitzCodec.ts';
import type { Source, SourceMessage } from '../src/source/Source.ts';

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

  class BlockingSource implements Source<string> {
    readonly name = 'blocking-source';
    readonly codec = StringCodec();

    async *messages(): AsyncIterable<SourceMessage<string>> {
      let index = 0;
      while (true) {
        yield { value: `tick-${index++}`, ack: () => {}, nak: () => {} };
        await Bun.sleep(50);
      }
    }
  }

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

    it('exposes standalone job metadata with restart disabled', async () => {
      const fresh = await BlitzService.connect({ servers: blitz.config.servers });
      const pipeline = fresh.pipeline('metadata-job');
      pipeline.readFrom(new BlockingSource()).map((value: string) => value).writeTo({
        name: 'collect-sink',
        write: async () => {},
      });
      const job = await fresh.newJob(pipeline, { name: 'metadata-job' });
      const metadata = await fresh.getJobMetadata(job.id);
      expect(metadata).toEqual({
        lightJob: true,
        participatingMembers: ['local'],
        supportsCancel: true,
        supportsRestart: false,
        executionStartTime: expect.any(Number),
        executionCompletionTime: null,
      });
      const metrics = await job.getMetrics();
      expect(Array.isArray(metrics)).toBe(false);
      await fresh.cancelJob(job.id);
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
      expect(String(BlitzEvent.JOB_STARTED)).toBe('JOB_STARTED');
      expect(String(BlitzEvent.JOB_COMPLETED)).toBe('JOB_COMPLETED');
      expect(String(BlitzEvent.JOB_FAILED)).toBe('JOB_FAILED');
      expect(String(BlitzEvent.JOB_CANCELLED)).toBe('JOB_CANCELLED');
      expect(String(BlitzEvent.JOB_SUSPENDED)).toBe('JOB_SUSPENDED');
      expect(String(BlitzEvent.JOB_RESTARTING)).toBe('JOB_RESTARTING');
      expect(String(BlitzEvent.SNAPSHOT_STARTED)).toBe('SNAPSHOT_STARTED');
      expect(String(BlitzEvent.SNAPSHOT_COMPLETED)).toBe('SNAPSHOT_COMPLETED');
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

    it('getJobMetadata() proxies to BlitzService', async () => {
      const nestService = new HeliosBlitzService(blitz);
      const pipeline = blitz.pipeline('nestjs-metadata');
      pipeline.readFrom(new BlockingSource()).map((value: string) => value).writeTo({
        name: 'collect-sink',
        write: async () => {},
      });
      const job = await nestService.newJob(pipeline);
      const metadata = await nestService.getJobMetadata(job.id);
      expect(metadata?.lightJob).toBe(true);
      expect(metadata?.supportsRestart).toBe(false);
      expect(metadata?.executionStartTime).toEqual(expect.any(Number));
      expect(metadata?.executionCompletionTime).toBeNull();
      await nestService.cancelJob(job.id);
    });
  });

  // ── Exports verification ──────────────────────────────

  describe('index.ts exports all job types', () => {
    it('exports BlitzJob class', () => {
      expect(BlitzJob).toBeDefined();
    });

    it('exports JobStatus enum', () => {
      expect(String(JobStatus.RUNNING)).toBe('RUNNING');
      expect(String(JobStatus.COMPLETED)).toBe('COMPLETED');
    });

    it('exports ProcessingGuarantee enum', () => {
      expect(String(ProcessingGuarantee.NONE)).toBe('NONE');
      expect(String(ProcessingGuarantee.AT_LEAST_ONCE)).toBe('AT_LEAST_ONCE');
    });
  });
});
