/**
 * MetricUnit — measurement unit constants for user-defined metrics.
 *
 * Matches Hazelcast Jet's ProbeUnit subset exposed to pipeline code.
 */
export enum MetricUnit {
  /** Dimensionless item count. Default for counters. */
  COUNT = 'count',
  /** Byte quantity (memory, network traffic). */
  BYTES = 'bytes',
  /** Duration in milliseconds. */
  MS = 'ms',
  /** Ratio expressed as a percentage (0–100). */
  PERCENT = 'percent',
  /** Boolean flag stored as 0 or 1. */
  BOOLEAN = 'boolean',
}
