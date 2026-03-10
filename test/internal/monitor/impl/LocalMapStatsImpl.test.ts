import { describe, expect, test } from 'bun:test';
import { LocalMapStatsImpl } from '../../../../src/internal/monitor/impl/LocalMapStatsImpl';

describe('LocalMapStatsImpl', () => {
  test('serializes to a JSON snapshot with owned entry counts', () => {
    const stats = new LocalMapStatsImpl();

    stats.setOwnedEntryCount(7);
    stats.setBackupEntryCount(2);
    stats.incrementPutCount(4);

    expect(JSON.parse(JSON.stringify(stats))).toEqual({
      getCount: 0,
      putCount: 1,
      removeCount: 0,
      setCount: 0,
      totalGetLatencyMs: 0,
      totalPutLatencyMs: 4,
      totalRemoveLatencyMs: 0,
      avgGetLatencyMs: 0,
      avgPutLatencyMs: 4,
      avgRemoveLatencyMs: 0,
      ownedEntryCount: 7,
      backupEntryCount: 2,
      heapCostBytes: 0,
      queryResultSizeExceededCount: 0,
    });
  });
});
