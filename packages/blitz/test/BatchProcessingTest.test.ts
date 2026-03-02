/**
 * Block 10.8 — Batch processing mode tests
 *
 * Tests: EndOfStreamDetector, BatchPipeline, BatchGeneralStage, BatchResult.
 * All tests are pure unit tests — no NATS required.
 *
 * ~20 tests total.
 */
import { describe, it, expect } from 'bun:test';
import { BatchPipeline } from '../src/batch/BatchPipeline.ts';
import type { BatchResult } from '../src/batch/BatchResult.ts';
import { EndOfStreamDetector } from '../src/batch/EndOfStreamDetector.ts';
import type { Source, SourceMessage } from '../src/source/Source.ts';
import type { Sink } from '../src/sink/Sink.ts';
import { BytesCodec } from '../src/codec/BlitzCodec.ts';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Create an in-memory bounded source from a fixed array of items. */
function arraySource<T>(items: T[]): Source<T> {
  return {
    name: 'array-source',
    codec: BytesCodec() as unknown as Source<T>['codec'],
    async *messages(): AsyncIterable<SourceMessage<T>> {
      for (const item of items) {
        yield { value: item, ack: () => {}, nak: () => {} };
      }
    },
  };
}

/** Sink that collects all written values for assertion. */
function collectSink<T>(): Sink<T> & { collected: T[] } {
  const collected: T[] = [];
  return {
    name: 'collect-sink',
    async write(value: T): Promise<void> {
      collected.push(value);
    },
    collected,
  };
}

/** Sink that throws on specific (1-based) call numbers. */
function failingSink<T>(failOnCalls: Set<number>): Sink<T> {
  let callCount = 0;
  return {
    name: 'failing-sink',
    async write(_value: T): Promise<void> {
      const n = ++callCount;
      if (failOnCalls.has(n)) {
        throw new Error(`Sink failure on call ${n}`);
      }
    },
  };
}

// ─── EndOfStreamDetector ──────────────────────────────────────────────────────

describe('EndOfStreamDetector', () => {
  it('count-based: resolves when expected count of acks received', async () => {
    const detector = new EndOfStreamDetector({ expectedCount: 3 });
    const p = detector.detect();
    detector.onAck();
    detector.onAck();
    detector.onAck();
    await p; // must resolve — would hang/timeout if not
    expect(true).toBe(true);
  });

  it('count-based: does not resolve before count is reached', async () => {
    const detector = new EndOfStreamDetector({ expectedCount: 3 });
    let resolved = false;
    detector.detect().then(() => {
      resolved = true;
    });
    detector.onAck();
    detector.onAck(); // only 2 of 3
    await Bun.sleep(10);
    expect(resolved).toBe(false);
  });

  it('idle-timeout: resolves after idle period', async () => {
    const detector = new EndOfStreamDetector({ idleTimeoutMs: 10 });
    let resolved = false;
    detector.detect().then(() => {
      resolved = true;
    });
    await Bun.sleep(40); // well past the 10ms idle timeout
    expect(resolved).toBe(true);
  });

  it('idle-timeout: does not resolve immediately', async () => {
    const detector = new EndOfStreamDetector({ idleTimeoutMs: 80 });
    let resolved = false;
    detector.detect().then(() => {
      resolved = true;
    });
    await Bun.sleep(5); // well before the 80ms idle timeout
    expect(resolved).toBe(false);
  });

  it('reset clears acked count and allows detector reuse', async () => {
    const detector = new EndOfStreamDetector({ expectedCount: 2 });
    const p1 = detector.detect();
    detector.onAck();
    detector.onAck();
    await p1; // resolves

    // After reset: state is cleared; a new detect() promise should not be pre-resolved
    detector.reset();
    let resolved = false;
    detector.detect().then(() => {
      resolved = true;
    });
    await Bun.sleep(10);
    expect(resolved).toBe(false); // no acks yet → should not resolve
  });

  it('onMessage resets the idle timer, delaying resolution', async () => {
    const detector = new EndOfStreamDetector({ idleTimeoutMs: 20 });
    const start = Date.now();
    const p = detector.detect();
    // Fire onMessage() at ~10ms — resets the idle timer
    await Bun.sleep(10);
    detector.onMessage();
    await p; // should resolve ~20ms after the onMessage() call = ~30ms total
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });
});

// ─── BatchPipeline ────────────────────────────────────────────────────────────

describe('BatchPipeline', () => {
  it('has the name passed to the constructor', () => {
    const p = new BatchPipeline('my-etl-job');
    expect(p.name).toBe('my-etl-job');
  });

  it('readFrom returns a stage with map, filter and writeTo methods', () => {
    const p = new BatchPipeline('stage-shape');
    const stage = p.readFrom(arraySource<string>([]));
    expect(typeof stage.writeTo).toBe('function');
    expect(typeof stage.map).toBe('function');
    expect(typeof stage.filter).toBe('function');
  });

  it('empty source produces a BatchResult with all-zero counts', async () => {
    const p = new BatchPipeline('empty');
    const sink = collectSink<string>();
    const result: BatchResult = await p.readFrom(arraySource<string>([])).writeTo(sink);
    expect(result.recordsIn).toBe(0);
    expect(result.recordsOut).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('counts recordsIn from all source messages', async () => {
    const p = new BatchPipeline('records-in');
    const sink = collectSink<string>();
    const result = await p.readFrom(arraySource(['a', 'b', 'c'])).writeTo(sink);
    expect(result.recordsIn).toBe(3);
  });

  it('counts recordsOut after successful sink writes', async () => {
    const p = new BatchPipeline('records-out');
    const sink = collectSink<string>();
    const result = await p.readFrom(arraySource(['x', 'y'])).writeTo(sink);
    expect(result.recordsOut).toBe(2);
    expect(sink.collected).toEqual(['x', 'y']);
  });

  it('map transforms each value in the pipeline', async () => {
    const p = new BatchPipeline('map-test');
    const sink = collectSink<number>();
    const result = await p
      .readFrom(arraySource(['1', '2', '3']))
      .map(s => parseInt(s, 10))
      .writeTo(sink);
    expect(sink.collected).toEqual([1, 2, 3]);
    expect(result.recordsOut).toBe(3);
  });

  it('filter reduces recordsOut but recordsIn counts all source messages', async () => {
    const p = new BatchPipeline('filter-test');
    const sink = collectSink<number>();
    const result = await p
      .readFrom(arraySource([1, 2, 3, 4, 5]))
      .filter(n => n % 2 === 0)
      .writeTo(sink);
    expect(result.recordsIn).toBe(5);
    expect(result.recordsOut).toBe(2);
    expect(sink.collected).toEqual([2, 4]);
  });

  it('durationMs is non-negative', async () => {
    const p = new BatchPipeline('duration-test');
    const sink = collectSink<number>();
    const result = await p.readFrom(arraySource([1, 2, 3])).writeTo(sink);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('error in map is captured in BatchResult.errors', async () => {
    const p = new BatchPipeline('map-error');
    const sink = collectSink<string>();
    const result = await p
      .readFrom(arraySource([1, 2, 3]))
      .map((n: number) => {
        if (n === 2) throw new Error('bad item');
        return String(n);
      })
      .writeTo(sink);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0]!.message).toBe('bad item');
    // Items 1 and 3 still succeed
    expect(result.recordsOut).toBe(2);
    expect(sink.collected).toEqual(['1', '3']);
  });

  it('error in sink is captured in BatchResult.errors', async () => {
    const p = new BatchPipeline('sink-error');
    const sink = failingSink<number>(new Set([2])); // fail on 2nd write
    const result = await p.readFrom(arraySource([10, 20, 30])).writeTo(sink);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0]!.message).toContain('Sink failure on call 2');
    // Items 10 and 30 succeed
    expect(result.recordsOut).toBe(2);
  });

  it('continues processing after an error (partial success)', async () => {
    const p = new BatchPipeline('partial-success');
    const sink = collectSink<string>();
    const result = await p
      .readFrom(arraySource(['ok', 'fail', 'ok']))
      .map(s => {
        if (s === 'fail') throw new Error('operator failed');
        return s.toUpperCase();
      })
      .writeTo(sink);
    expect(result.recordsIn).toBe(3);
    expect(result.recordsOut).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(sink.collected).toEqual(['OK', 'OK']);
  });

  it('errorCount always equals errors.length', async () => {
    const p = new BatchPipeline('error-count');
    const sink = collectSink<number>();
    const result = await p
      .readFrom(arraySource([1, 2, 3, 4, 5]))
      .map((n: number) => {
        if (n % 2 === 0) throw new Error('even rejected');
        return n;
      })
      .writeTo(sink);
    expect(result.errorCount).toBe(result.errors.length);
    expect(result.errorCount).toBe(2); // n=2 and n=4
  });

  it('chains map + filter + map correctly', async () => {
    const p = new BatchPipeline('chain-test');
    const sink = collectSink<string>();
    const result = await p
      .readFrom(arraySource([1, 2, 3, 4, 5, 6]))
      .map((n: number) => n * 2)      // [2, 4, 6, 8, 10, 12]
      .filter((n: number) => n > 6)   // [8, 10, 12]
      .map((n: number) => `value:${n}`) // ['value:8', 'value:10', 'value:12']
      .writeTo(sink);
    expect(sink.collected).toEqual(['value:8', 'value:10', 'value:12']);
    expect(result.recordsIn).toBe(6);
    expect(result.recordsOut).toBe(3);
  });

  it('async map transform resolves in order', async () => {
    const p = new BatchPipeline('async-map');
    const sink = collectSink<string>();
    const result = await p
      .readFrom(arraySource([1, 2, 3]))
      .map(async (n: number) => {
        await Bun.sleep(1);
        return `async:${n}`;
      })
      .writeTo(sink);
    expect(sink.collected).toEqual(['async:1', 'async:2', 'async:3']);
    expect(result.recordsOut).toBe(3);
  });
});
