import { describe, it, expect } from 'bun:test';
import { BackoffIdleStrategy } from '@zenystx/core/internal/util/concurrent/BackoffIdleStrategy';

describe('BackoffIdleStrategyTest', () => {
  it('test_createBackoffIdleStrategy', () => {
    const s = BackoffIdleStrategy.createBackoffIdleStrategy('foo,1,2,10,15');
    expect(s.yieldThreshold).toEqual(1);
    expect(s.parkThreshold).toEqual(3);
    expect(s.minParkPeriodNs).toEqual(10);
    expect(s.maxParkPeriodNs).toEqual(15);
  });

  it('test_createBackoffIdleStrategy_invalidConfig', () => {
    expect(() => BackoffIdleStrategy.createBackoffIdleStrategy('foo,1')).toThrow();
  });

  it('when_proposedShiftLessThanAllowed_then_shiftProposed', () => {
    const s = new BackoffIdleStrategy(0, 0, 1, 4);
    expect(s.parkTime(0)).toEqual(1);
    expect(s.parkTime(1)).toEqual(2);
  });

  it('when_maxShiftedGreaterThanMaxParkTime_thenParkMax', () => {
    const s = new BackoffIdleStrategy(0, 0, 3, 4);
    expect(s.parkTime(0)).toEqual(3);
    expect(s.parkTime(1)).toEqual(4);
    expect(s.parkTime(2)).toEqual(4);
  });

  it('when_maxShiftedLessThanMaxParkTime_thenParkMaxShifted', () => {
    const s = new BackoffIdleStrategy(0, 0, 2, 3);
    expect(s.parkTime(0)).toEqual(2);
    expect(s.parkTime(1)).toEqual(3);
    expect(s.parkTime(2)).toEqual(3);
  });
});
