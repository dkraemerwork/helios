import { Preconditions } from '@zenystx/core/internal/util/Preconditions';

/**
 * Idling strategy with exponential backoff.
 * Port of com.hazelcast.internal.util.concurrent.BackoffIdleStrategy.
 */
export class BackoffIdleStrategy {
  readonly yieldThreshold: number;
  readonly parkThreshold: number;
  readonly minParkPeriodNs: number;
  readonly maxParkPeriodNs: number;
  private readonly maxShift: number;

  constructor(maxSpins: number, maxYields: number, minParkPeriodNs: number, maxParkPeriodNs: number) {
    Preconditions.checkNotNegative(maxSpins, 'maxSpins must be positive or zero');
    Preconditions.checkNotNegative(maxYields, 'maxYields must be positive or zero');
    Preconditions.checkNotNegative(minParkPeriodNs, 'minParkPeriodNs must be positive or zero');
    Preconditions.checkNotNegative(
      maxParkPeriodNs - minParkPeriodNs,
      'maxParkPeriodNs must be greater than or equal to minParkPeriodNs'
    );
    this.yieldThreshold = maxSpins;
    this.parkThreshold = maxSpins + maxYields;
    this.minParkPeriodNs = minParkPeriodNs;
    this.maxParkPeriodNs = maxParkPeriodNs;
    this.maxShift = BackoffIdleStrategy._nlz(minParkPeriodNs) - BackoffIdleStrategy._nlz(maxParkPeriodNs);
  }

  /** Compute number of leading zeros (for 32-bit representation) */
  private static _nlz(x: number): number {
    if (x === 0) return 32;
    return Math.clz32(x);
  }

  parkTime(n: number): number {
    const proposedShift = n - this.parkThreshold;
    const allowedShift = Math.min(this.maxShift, proposedShift);
    if (proposedShift > this.maxShift) return this.maxParkPeriodNs;
    if (proposedShift < this.maxShift) return this.minParkPeriodNs * (1 << allowedShift);
    return Math.min(this.minParkPeriodNs * (1 << allowedShift), this.maxParkPeriodNs);
  }

  idle(n: number): boolean {
    if (n < this.yieldThreshold) return false;
    if (n < this.parkThreshold) return false;
    const parkTime = this.parkTime(n);
    return parkTime === this.maxParkPeriodNs;
  }

  static createBackoffIdleStrategy(config: string): BackoffIdleStrategy {
    const args = config.split(',');
    if (args.length < 5) {
      throw new Error(`Invalid BackoffIdleStrategy config: "${config}". Expected 5 comma-separated values.`);
    }
    return new BackoffIdleStrategy(
      parseInt(args[1], 10),
      parseInt(args[2], 10),
      parseInt(args[3], 10),
      parseInt(args[4], 10)
    );
  }
}
