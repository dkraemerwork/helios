import type { Source } from '../source/Source.js';
import type { Sink } from '../sink/Sink.js';
import type { BatchResult } from './BatchResult.js';

// ─── Internal operator chain types ───────────────────────────────────────────

type MapOp = { type: 'map'; fn: (v: unknown) => unknown | Promise<unknown> };
type FilterOp = { type: 'filter'; fn: (v: unknown) => boolean };
type OpEntry = MapOp | FilterOp;

type ApplyResult =
  | { kind: 'value'; value: unknown }
  | { kind: 'filtered' }
  | { kind: 'error'; error: Error };

/** Apply each operator in `ops` to `value` in sequence. */
async function applyOps(value: unknown, ops: ReadonlyArray<OpEntry>): Promise<ApplyResult> {
  let current = value;
  for (const op of ops) {
    try {
      if (op.type === 'map') {
        current = await op.fn(current);
      } else {
        if (!op.fn(current)) {
          return { kind: 'filtered' };
        }
      }
    } catch (e) {
      return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
    }
  }
  return { kind: 'value', value: current };
}

/**
 * Core execution engine for {@link BatchPipeline}.
 * Drives the source to exhaustion, applies the operator chain, writes to the sink.
 */
async function runBatch(
  source: Source<unknown>,
  ops: ReadonlyArray<OpEntry>,
  sinkWrite: (value: unknown) => Promise<void>,
): Promise<BatchResult> {
  const startMs = Date.now();
  let recordsIn = 0;
  let recordsOut = 0;
  const errors: Error[] = [];

  for await (const msg of source.messages()) {
    recordsIn++;
    const applied = await applyOps(msg.value, ops);

    if (applied.kind === 'error') {
      errors.push(applied.error);
    } else if (applied.kind === 'value') {
      try {
        await sinkWrite(applied.value);
        recordsOut++;
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    // kind === 'filtered' → record not written; does not count as error
  }

  return {
    recordsIn,
    recordsOut,
    errorCount: errors.length,
    durationMs: Date.now() - startMs,
    errors,
  };
}

// Internal type alias for the runner function threaded through the stage chain.
type BatchRunner = (
  ops: ReadonlyArray<OpEntry>,
  sinkWrite: (value: unknown) => Promise<void>,
) => Promise<BatchResult>;

// ─── BatchGeneralStage ────────────────────────────────────────────────────────

/**
 * Fluent stage handle returned by {@link BatchPipeline.readFrom} and each
 * chaining call on a batch pipeline.
 *
 * Unlike the streaming {@link GeneralStage}, `writeTo()` on a batch stage
 * **executes** the pipeline synchronously (bounded source exhaustion) and
 * returns a `Promise<BatchResult>`.
 *
 * ```typescript
 * const result = await blitz.batch('etl-job')
 *   .readFrom(FileSource.lines('/data/input.ndjson'))
 *   .map(line => JSON.parse(line))
 *   .filter(record => record.status === 'active')
 *   .writeTo(HeliosMapSink.put(activeUsersMap));
 *
 * console.log(`Processed ${result.recordsOut} records in ${result.durationMs}ms`);
 * ```
 */
export class BatchGeneralStage<T> {
  constructor(
    private readonly _run: BatchRunner,
    private readonly _ops: ReadonlyArray<OpEntry>,
  ) {}

  /**
   * Append a map (transform) operator to the batch pipeline.
   *
   * @param fn - synchronous or asynchronous transform function T → R
   */
  map<R>(fn: (value: T) => R | Promise<R>): BatchGeneralStage<R> {
    return new BatchGeneralStage<R>(this._run, [
      ...this._ops,
      { type: 'map', fn: fn as (v: unknown) => unknown | Promise<unknown> },
    ]);
  }

  /**
   * Append a filter operator to the batch pipeline.
   * Records for which `fn` returns `false` are dropped (not counted in `recordsOut`
   * and not counted as errors).
   *
   * @param fn - predicate; records where `fn(value) === false` are dropped
   */
  filter(fn: (value: T) => boolean): BatchGeneralStage<T> {
    return new BatchGeneralStage<T>(this._run, [
      ...this._ops,
      { type: 'filter', fn: fn as (v: unknown) => boolean },
    ]);
  }

  /**
   * Terminate the batch stage chain, execute the pipeline, and return the result.
   *
   * Iterates the source to exhaustion, applies every operator in sequence,
   * and writes passing records to `sink`. Errors in operators or the sink are
   * captured rather than thrown; processing continues for all subsequent records.
   *
   * @returns A `Promise<BatchResult>` with counts and any captured errors.
   */
  writeTo(sink: Sink<T>): Promise<BatchResult> {
    return this._run(this._ops, value => sink.write(value as T));
  }
}

// ─── BatchPipeline ────────────────────────────────────────────────────────────

/**
 * Bounded (batch) variant of the Blitz pipeline.
 *
 * A batch pipeline reads from a **finite** source (e.g. `FileSource.lines()`,
 * `HeliosMapSource.snapshot()`, or a JetStream stream with `deliverAll`),
 * processes records through a chain of operators, and terminates when the
 * source is exhausted.
 *
 * Build and run via the fluent API:
 * ```typescript
 * const result = await new BatchPipeline('job')
 *   .readFrom(FileSource.lines('/data/input.ndjson'))
 *   .map(line => JSON.parse(line))
 *   .writeTo(LogSink.console());
 * ```
 *
 * Or via `BlitzService.batch(name)` which returns a `BatchPipeline`.
 */
export class BatchPipeline {
  /** Unique name for this batch pipeline (used for logging and metrics). */
  readonly name: string;

  private _source?: Source<unknown>;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Set the bounded source and return a `BatchGeneralStage` for further chaining.
   * The source must be finite — its `messages()` iterator must eventually complete.
   */
  readFrom<T>(source: Source<T>): BatchGeneralStage<T> {
    this._source = source as Source<unknown>;
    const runner: BatchRunner = (ops, write) => {
      if (!this._source) {
        return Promise.resolve({ recordsIn: 0, recordsOut: 0, errorCount: 0, durationMs: 0, errors: [] });
      }
      return runBatch(this._source, ops, write);
    };
    return new BatchGeneralStage<T>(runner, []);
  }
}
