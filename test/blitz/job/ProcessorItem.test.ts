import { describe, expect, it } from 'bun:test';
import type { ProcessorItem } from '@zenystx/helios-core/job/engine/ProcessorItem.js';

describe('ProcessorItem', () => {
  it('supports data items with optional key', () => {
    const item: ProcessorItem = { type: 'data', value: 42, timestamp: Date.now() };
    expect(item.type).toBe('data');
    const keyed: ProcessorItem = { type: 'data', value: 'hello', key: 'k1', timestamp: 100 };
    expect(keyed.type).toBe('data');
    expect((keyed as { key?: string }).key).toBe('k1');
  });

  it('supports barrier items', () => {
    const item: ProcessorItem = { type: 'barrier', snapshotId: 'snap-123' };
    expect(item.type).toBe('barrier');
  });

  it('supports eos items', () => {
    const item: ProcessorItem = { type: 'eos' };
    expect(item.type).toBe('eos');
  });

  it('supports watermark items', () => {
    const item: ProcessorItem = { type: 'watermark', timestamp: 1000 };
    expect(item.type).toBe('watermark');
  });
});
