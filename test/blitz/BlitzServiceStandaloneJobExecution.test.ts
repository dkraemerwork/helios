import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BlitzService } from '@zenystx/helios-blitz/BlitzService';
import { Pipeline } from '@zenystx/helios-blitz/Pipeline';
import { StringCodec } from '@zenystx/helios-blitz/codec/BlitzCodec';
import { BlitzEvent } from '@zenystx/helios-blitz/BlitzEvent';
import type { Sink } from '@zenystx/helios-blitz/sink/Sink';
import type { Source, SourceMessage } from '@zenystx/helios-blitz/source/Source';
import { JobStatus } from '@zenystx/helios-core/job/JobStatus';

class ArraySource implements Source<string> {
  readonly name = 'array-source';
  readonly codec = StringCodec();

  constructor(private readonly values: string[]) {}

  async *messages(): AsyncIterable<SourceMessage<string>> {
    for (const value of this.values) {
      yield { value, ack: () => {}, nak: () => {} };
    }
  }
}

class CollectSink implements Sink<string> {
  readonly name = 'collect-sink';
  readonly values: string[] = [];

  async write(value: string): Promise<void> {
    this.values.push(value);
  }
}

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

describe('BlitzService standalone jobs', () => {
  let blitz: BlitzService;

  beforeEach(async () => {
    blitz = await BlitzService.start({ embedded: {} });
  });

  afterEach(async () => {
    await blitz.shutdown();
  });

  it('executes a real standalone pipeline and exposes metrics', async () => {
    const sink = new CollectSink();
    const pipeline = new Pipeline('standalone-market-job');
    pipeline
      .readFrom(new ArraySource(['btc', 'eth', 'xrp']))
      .map((value: string) => value.toUpperCase())
      .writeTo(sink);

    const job = await blitz.newJob(pipeline, { name: 'standalone-market-job' });

    for (let i = 0; i < 30 && job.getStatus() === 'RUNNING'; i++) {
      await Bun.sleep(20);
    }

    expect(sink.values).toEqual(['BTC', 'ETH', 'XRP']);
    expect(job.getStatus()).toBe(JobStatus.COMPLETED);

    const metrics = await job.getMetrics();
    expect(Array.isArray(metrics)).toBe(false);
    const aggregated = metrics as { totalIn: number; totalOut: number; vertices: Map<string, { itemsOut: number; itemsIn: number }> };
    expect(aggregated.totalIn).toBe(3);
    expect(aggregated.totalOut).toBe(3);
    expect(aggregated.vertices.get('array-source')?.itemsOut).toBe(3);
    expect(aggregated.vertices.get('collect-sink')?.itemsIn).toBe(3);
    expect(blitz.getJobs().some((candidate: { id: string }) => candidate.id === job.id)).toBe(true);
    expect(blitz.getJobDescriptor(job.id)?.vertices.length).toBe(3);
    await expect(blitz.restartJob(job.id)).rejects.toThrow('Job restart is not supported for standalone/light jobs.');
  });

  it('cancelling a standalone job keeps it cancelled and does not emit completion', async () => {
    const events: BlitzEvent[] = [];
    blitz.on((event) => events.push(event));

    const sink = new CollectSink();
    const pipeline = new Pipeline('standalone-cancel-job');
    pipeline
      .readFrom(new BlockingSource())
      .map((value: string) => value.toUpperCase())
      .writeTo(sink);

    const job = await blitz.newJob(pipeline, { name: 'standalone-cancel-job' });
    await Bun.sleep(20);
    await blitz.cancelJob(job.id);
    await job.join();

    expect(job.getStatus()).toBe(JobStatus.CANCELLED);
    expect(events).toContain(BlitzEvent.JOB_CANCELLED);
    expect(events).not.toContain(BlitzEvent.JOB_COMPLETED);
    await expect(blitz.cancelJob(job.id)).rejects.toThrow(`Job '${job.id}' is already in terminal state 'CANCELLED'`);
    await expect(blitz.restartJob(job.id)).rejects.toThrow('Job restart is not supported for standalone/light jobs.');
  });
});
