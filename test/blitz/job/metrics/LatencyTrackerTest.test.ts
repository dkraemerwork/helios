import { describe, expect, it } from 'bun:test';
import { LatencyTracker } from '@zenystx/helios-core/job/metrics/LatencyTracker.js';

describe('LatencyTracker', () => {
  it('should return 0 for all percentiles when empty', () => {
    const tracker = new LatencyTracker(128);
    expect(tracker.getP50()).toBe(0);
    expect(tracker.getP99()).toBe(0);
    expect(tracker.getMax()).toBe(0);
    expect(tracker.count).toBe(0);
  });

  it('should track a single record', () => {
    const tracker = new LatencyTracker(128);
    tracker.record(42);
    expect(tracker.getP50()).toBe(42);
    expect(tracker.getP99()).toBe(42);
    expect(tracker.getMax()).toBe(42);
    expect(tracker.count).toBe(1);
  });

  it('should compute p50 accurately', () => {
    const tracker = new LatencyTracker(256);
    // Record values 1..100
    for (let i = 1; i <= 100; i++) {
      tracker.record(i);
    }
    // p50 of 1..100 should be ~50
    const p50 = tracker.getP50();
    expect(p50).toBeGreaterThanOrEqual(49);
    expect(p50).toBeLessThanOrEqual(51);
  });

  it('should compute p99 accurately', () => {
    const tracker = new LatencyTracker(256);
    for (let i = 1; i <= 100; i++) {
      tracker.record(i);
    }
    // p99 of 1..100 should be ~99
    const p99 = tracker.getP99();
    expect(p99).toBeGreaterThanOrEqual(98);
    expect(p99).toBeLessThanOrEqual(100);
  });

  it('should compute max accurately', () => {
    const tracker = new LatencyTracker(256);
    tracker.record(5);
    tracker.record(100);
    tracker.record(3);
    tracker.record(200);
    tracker.record(1);
    expect(tracker.getMax()).toBe(200);
  });

  it('should handle buffer rotation (circular buffer)', () => {
    const tracker = new LatencyTracker(8); // small buffer
    // Write more than capacity to test rotation
    for (let i = 1; i <= 20; i++) {
      tracker.record(i * 10);
    }
    // Only last 8 values should be tracked: 130,140,150,160,170,180,190,200
    expect(tracker.count).toBe(8);
    expect(tracker.getMax()).toBe(200);
    const p50 = tracker.getP50();
    // Median of [130,140,150,160,170,180,190,200] ≈ 165
    expect(p50).toBeGreaterThanOrEqual(160);
    expect(p50).toBeLessThanOrEqual(170);
  });

  it('should reset all state', () => {
    const tracker = new LatencyTracker(128);
    tracker.record(10);
    tracker.record(20);
    tracker.record(30);
    tracker.reset();
    expect(tracker.count).toBe(0);
    expect(tracker.getP50()).toBe(0);
    expect(tracker.getP99()).toBe(0);
    expect(tracker.getMax()).toBe(0);
  });
});
