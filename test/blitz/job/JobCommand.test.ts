import { describe, expect, it } from 'bun:test';
import type { JobCommand } from '@zenystx/helios-core/job/JobCommand.js';

describe('JobCommand', () => {
  it('supports all 9 command types', () => {
    const commands: JobCommand[] = [
      { type: 'START_EXECUTION', jobId: 'j1', plan: {} as any },
      { type: 'STOP_EXECUTION', jobId: 'j1', reason: 'cancel' },
      { type: 'INJECT_BARRIER', jobId: 'j1', snapshotId: 's1' },
      { type: 'BARRIER_COMPLETE', jobId: 'j1', snapshotId: 's1', memberId: 'm1', sizeBytes: 1024 },
      { type: 'EXECUTION_READY', jobId: 'j1', memberId: 'm1' },
      { type: 'EXECUTION_FAILED', jobId: 'j1', memberId: 'm1', error: 'oops' },
      { type: 'EXECUTION_COMPLETED', jobId: 'j1', memberId: 'm1' },
      { type: 'COLLECT_METRICS', jobId: 'j1', requestId: 'r1' },
      { type: 'METRICS_RESPONSE', jobId: 'j1', requestId: 'r1', memberId: 'm1', metrics: [] },
    ];
    expect(commands).toHaveLength(9);
    const types = commands.map((c) => c.type);
    expect(new Set(types).size).toBe(9);
  });

  it('STOP_EXECUTION has constrained reason values', () => {
    const reasons: Array<'cancel' | 'suspend' | 'restart'> = ['cancel', 'suspend', 'restart'];
    for (const reason of reasons) {
      const cmd: JobCommand = { type: 'STOP_EXECUTION', jobId: 'j1', reason };
      expect(cmd.type).toBe('STOP_EXECUTION');
    }
  });
});
