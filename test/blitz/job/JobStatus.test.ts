import { describe, expect, it } from 'bun:test';
import { JobStatus, isTerminalStatus } from '@zenystx/helios-core/job/JobStatus.js';

describe('JobStatus', () => {
  it('has exactly 10 Jet-parity states', () => {
    const values = Object.values(JobStatus);
    expect(values).toHaveLength(10);
  });

  it('contains all 10 Jet states with correct string values', () => {
    expect(String(JobStatus.NOT_RUNNING)).toBe('NOT_RUNNING');
    expect(String(JobStatus.STARTING)).toBe('STARTING');
    expect(String(JobStatus.RUNNING)).toBe('RUNNING');
    expect(String(JobStatus.COMPLETING)).toBe('COMPLETING');
    expect(String(JobStatus.COMPLETED)).toBe('COMPLETED');
    expect(String(JobStatus.FAILED)).toBe('FAILED');
    expect(String(JobStatus.CANCELLED)).toBe('CANCELLED');
    expect(String(JobStatus.SUSPENDED_EXPORTING_SNAPSHOT)).toBe('SUSPENDED_EXPORTING_SNAPSHOT');
    expect(String(JobStatus.SUSPENDED)).toBe('SUSPENDED');
    expect(String(JobStatus.RESTARTING)).toBe('RESTARTING');
  });

  it('identifies terminal statuses correctly', () => {
    expect(isTerminalStatus(JobStatus.COMPLETED)).toBe(true);
    expect(isTerminalStatus(JobStatus.FAILED)).toBe(true);
    expect(isTerminalStatus(JobStatus.CANCELLED)).toBe(true);
    expect(isTerminalStatus(JobStatus.RUNNING)).toBe(false);
    expect(isTerminalStatus(JobStatus.NOT_RUNNING)).toBe(false);
    expect(isTerminalStatus(JobStatus.SUSPENDED)).toBe(false);
  });
});
