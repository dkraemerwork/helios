/**
 * Result of a completed batch pipeline execution.
 *
 * Returned by {@link BatchGeneralStage.writeTo} after all source records have
 * been processed and the pipeline has been shut down.
 */
export interface BatchResult {
  /** Total number of records consumed from the source (including errored records). */
  recordsIn: number;
  /** Total number of records successfully written to the sink. */
  recordsOut: number;
  /** Number of records that failed in an operator or the sink. Always equals `errors.length`. */
  errorCount: number;
  /** Wall-clock duration in milliseconds from pipeline start to completion. */
  durationMs: number;
  /** Errors captured during processing. One entry per failed record. */
  errors: Error[];
}
