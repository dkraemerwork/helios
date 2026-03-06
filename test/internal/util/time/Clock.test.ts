import { describe, expect, it, beforeEach } from 'bun:test';
import { SystemClock, ManualClock, fixedClock } from '@zenystx/core/internal/util/time/Clock';
import type { TimeSource } from '@zenystx/core/internal/util/time/TimeSource';

describe('TimeSource contract', () => {
  it('SystemClock is a TimeSource', () => {
    const clock: TimeSource = SystemClock;
    expect(typeof clock.nowMillis).toBe('function');
  });

  it('SystemClock.nowMillis() returns a positive epoch millis value', () => {
    const now = SystemClock.nowMillis();
    expect(typeof now).toBe('number');
    // Should be somewhere after 2020-01-01
    expect(now).toBeGreaterThan(1577836800000);
  });

  it('SystemClock.nowMillis() is monotonically non-decreasing over consecutive calls', () => {
    const t1 = SystemClock.nowMillis();
    const t2 = SystemClock.nowMillis();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});

describe('fixedClock', () => {
  it('always returns the fixed epoch millis', () => {
    const clock = fixedClock(1_000_000);
    expect(clock.nowMillis()).toBe(1_000_000);
    expect(clock.nowMillis()).toBe(1_000_000);
  });

  it('is a TimeSource', () => {
    const clock: TimeSource = fixedClock(42);
    expect(clock.nowMillis()).toBe(42);
  });

  it('zero millis is valid', () => {
    const clock = fixedClock(0);
    expect(clock.nowMillis()).toBe(0);
  });
});

describe('ManualClock', () => {
  let clock: ManualClock;

  beforeEach(() => {
    clock = new ManualClock(1000);
  });

  it('starts at the given epoch millis', () => {
    expect(clock.nowMillis()).toBe(1000);
  });

  it('defaults to 0 when no initial value given', () => {
    const c = new ManualClock();
    expect(c.nowMillis()).toBe(0);
  });

  it('advance() increases time by delta', () => {
    clock.advance(500);
    expect(clock.nowMillis()).toBe(1500);
  });

  it('advance() can be called multiple times cumulatively', () => {
    clock.advance(100);
    clock.advance(200);
    clock.advance(300);
    expect(clock.nowMillis()).toBe(1600);
  });

  it('set() overrides time to exactly the given value', () => {
    clock.set(9999);
    expect(clock.nowMillis()).toBe(9999);
  });

  it('set() followed by advance() produces correct result', () => {
    clock.set(5000);
    clock.advance(250);
    expect(clock.nowMillis()).toBe(5250);
  });

  it('is a TimeSource', () => {
    const ts: TimeSource = clock;
    expect(ts.nowMillis()).toBe(1000);
  });
});

describe('Temporal / Date.now fallback', () => {
  it('SystemClock result is close to Date.now() within 100ms', () => {
    const before = Date.now();
    const clockNow = SystemClock.nowMillis();
    const after = Date.now();
    expect(clockNow).toBeGreaterThanOrEqual(before);
    expect(clockNow).toBeLessThanOrEqual(after + 100);
  });
});
