import { describe, expect, it } from 'bun:test';
import {
  ProcessingGuarantee,
  resolveJobConfig,
  type JobConfig,
  type ResolvedJobConfig,
} from '@zenystx/helios-core/job/JobConfig.js';

describe('ProcessingGuarantee', () => {
  it('has exactly three values', () => {
    expect(String(ProcessingGuarantee.NONE)).toBe('NONE');
    expect(String(ProcessingGuarantee.AT_LEAST_ONCE)).toBe('AT_LEAST_ONCE');
    expect(String(ProcessingGuarantee.EXACTLY_ONCE)).toBe('EXACTLY_ONCE');
    const values = Object.values(ProcessingGuarantee);
    expect(values).toHaveLength(3);
  });
});

describe('resolveJobConfig', () => {
  it('applies Jet-matching defaults when called with no config', () => {
    const resolved = resolveJobConfig();
    expect(resolved.processingGuarantee).toBe(ProcessingGuarantee.NONE);
    expect(resolved.snapshotIntervalMillis).toBe(10_000);
    expect(resolved.autoScaling).toBe(true);
    expect(resolved.suspendOnFailure).toBe(false);
    expect(resolved.scaleUpDelayMillis).toBe(10_000);
    expect(resolved.splitBrainProtection).toBe(false);
    expect(resolved.maxProcessorAccumulatedRecords).toBe(16_384);
    expect(resolved.initialSnapshotName).toBeUndefined();
  });

  it('generates a name when none is provided', () => {
    const resolved = resolveJobConfig();
    expect(resolved.name).toBeTruthy();
    expect(typeof resolved.name).toBe('string');
  });

  it('uses pipeline name as fallback for job name', () => {
    const resolved = resolveJobConfig(undefined, 'my-pipeline');
    expect(resolved.name).toBe('my-pipeline');
  });

  it('preserves user-provided config values', () => {
    const config: JobConfig = {
      name: 'my-job',
      processingGuarantee: ProcessingGuarantee.EXACTLY_ONCE,
      snapshotIntervalMillis: 5000,
      autoScaling: false,
      suspendOnFailure: true,
      scaleUpDelayMillis: 20_000,
      splitBrainProtection: true,
      maxProcessorAccumulatedRecords: 8192,
      initialSnapshotName: 'snap-1',
    };
    const resolved = resolveJobConfig(config);
    expect(resolved.name).toBe('my-job');
    expect(resolved.processingGuarantee).toBe(ProcessingGuarantee.EXACTLY_ONCE);
    expect(resolved.snapshotIntervalMillis).toBe(5000);
    expect(resolved.autoScaling).toBe(false);
    expect(resolved.suspendOnFailure).toBe(true);
    expect(resolved.scaleUpDelayMillis).toBe(20_000);
    expect(resolved.splitBrainProtection).toBe(true);
    expect(resolved.maxProcessorAccumulatedRecords).toBe(8192);
    expect(resolved.initialSnapshotName).toBe('snap-1');
  });

  it('validates snapshotIntervalMillis is positive', () => {
    expect(() => resolveJobConfig({ snapshotIntervalMillis: 0 })).toThrow();
    expect(() => resolveJobConfig({ snapshotIntervalMillis: -1 })).toThrow();
  });

  it('validates maxProcessorAccumulatedRecords is positive', () => {
    expect(() => resolveJobConfig({ maxProcessorAccumulatedRecords: 0 })).toThrow();
    expect(() => resolveJobConfig({ maxProcessorAccumulatedRecords: -5 })).toThrow();
  });
});
