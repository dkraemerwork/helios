import { describe, it, expect, beforeEach } from 'bun:test';
import { MapOperator } from '../src/operator/MapOperator.ts';
import { FilterOperator } from '../src/operator/FilterOperator.ts';
import { FlatMapOperator } from '../src/operator/FlatMapOperator.ts';
import { MergeOperator } from '../src/operator/MergeOperator.ts';
import { BranchOperator } from '../src/operator/BranchOperator.ts';
import { PeekOperator } from '../src/operator/PeekOperator.ts';
import { NakError } from '../src/errors/NakError.ts';
import type { StageContext } from '../src/StageContext.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    messageId: 'msg-1',
    deliveryCount: 1,
    nak: () => {},
    ...overrides,
  };
}

// ─── MapOperator ──────────────────────────────────────────────────────────────

describe('MapOperator', () => {
  it('transforms value with sync fn', async () => {
    const op = new MapOperator<number, string>((n) => String(n * 2));
    const result = await op.process(5, makeCtx());
    expect(result).toBe('10');
  });

  it('transforms value with async fn', async () => {
    const op = new MapOperator<string, string>(async (s) => s.toUpperCase());
    const result = await op.process('hello', makeCtx());
    expect(result).toBe('HELLO');
  });

  it('passes NakError from fn without wrapping', async () => {
    const nakErr = new NakError('intentional nak');
    const op = new MapOperator<number, number>((_) => { throw nakErr; });
    await expect(op.process(1, makeCtx())).rejects.toBe(nakErr);
  });

  it('wraps non-NakError from fn in NakError', async () => {
    const op = new MapOperator<number, number>((_) => { throw new Error('boom'); });
    const rejection = op.process(1, makeCtx());
    await expect(rejection).rejects.toBeInstanceOf(NakError);
  });

  it('wraps async fn rejection in NakError', async () => {
    const op = new MapOperator<number, number>(async (_) => { throw new TypeError('async boom'); });
    await expect(op.process(1, makeCtx())).rejects.toBeInstanceOf(NakError);
  });
});

// ─── FilterOperator ───────────────────────────────────────────────────────────

describe('FilterOperator', () => {
  it('returns value when sync predicate is true', async () => {
    const op = new FilterOperator<number>((n) => n > 0);
    const result = await op.process(5, makeCtx());
    expect(result).toBe(5);
  });

  it('returns undefined (void) when sync predicate is false', async () => {
    const op = new FilterOperator<number>((n) => n > 0);
    const result = await op.process(-1, makeCtx());
    expect(result).toBeUndefined();
  });

  it('supports async predicate returning true', async () => {
    const op = new FilterOperator<string>(async (s) => s.length > 3);
    const result = await op.process('hello', makeCtx());
    expect(result).toBe('hello');
  });

  it('supports async predicate returning false', async () => {
    const op = new FilterOperator<string>(async (s) => s.length > 3);
    const result = await op.process('hi', makeCtx());
    expect(result).toBeUndefined();
  });

  it('passes NakError from predicate without wrapping', async () => {
    const nakErr = new NakError('pred nak');
    const op = new FilterOperator<number>((_) => { throw nakErr; });
    await expect(op.process(1, makeCtx())).rejects.toBe(nakErr);
  });

  it('wraps non-NakError from predicate in NakError', async () => {
    const op = new FilterOperator<number>((_) => { throw new Error('pred boom'); });
    await expect(op.process(1, makeCtx())).rejects.toBeInstanceOf(NakError);
  });
});

// ─── FlatMapOperator ──────────────────────────────────────────────────────────

describe('FlatMapOperator', () => {
  it('expands sync array output', async () => {
    const op = new FlatMapOperator<string, string>((s) => s.split(''));
    const result = await op.process('abc', makeCtx());
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array when fn returns []', async () => {
    const op = new FlatMapOperator<number, number>((_) => []);
    const result = await op.process(42, makeCtx());
    expect(result).toEqual([]);
  });

  it('expands async generator output', async () => {
    async function* gen(n: number) {
      for (let i = 0; i < n; i++) yield i;
    }
    const op = new FlatMapOperator<number, number>((n) => gen(n));
    const result = await op.process(3, makeCtx());
    expect(result).toEqual([0, 1, 2]);
  });

  it('wraps non-NakError from fn in NakError', async () => {
    const op = new FlatMapOperator<number, number>((_) => { throw new Error('flatmap boom'); });
    await expect(op.process(1, makeCtx())).rejects.toBeInstanceOf(NakError);
  });

  it('passes NakError from fn without wrapping', async () => {
    const nakErr = new NakError('flatmap nak');
    const op = new FlatMapOperator<number, number>((_) => { throw nakErr; });
    await expect(op.process(1, makeCtx())).rejects.toBe(nakErr);
  });
});

// ─── PeekOperator ─────────────────────────────────────────────────────────────

describe('PeekOperator', () => {
  it('calls side-effect fn and returns value unchanged', async () => {
    const observed: number[] = [];
    const op = new PeekOperator<number>((n) => { observed.push(n); });
    const result = await op.process(42, makeCtx());
    expect(result).toBe(42);
    expect(observed).toEqual([42]);
  });

  it('awaits async side-effect before returning', async () => {
    const log: string[] = [];
    const op = new PeekOperator<string>(async (s) => {
      await Promise.resolve();
      log.push(s);
    });
    const result = await op.process('hello', makeCtx());
    expect(result).toBe('hello');
    expect(log).toEqual(['hello']);
  });

  it('does not modify the value', async () => {
    const obj = { x: 1, y: 2 };
    const op = new PeekOperator<typeof obj>((_) => { /* no-op */ });
    const result = await op.process(obj, makeCtx());
    expect(result).toBe(obj); // same reference
  });

  it('wraps error from fn in NakError', async () => {
    const op = new PeekOperator<number>((_) => { throw new Error('peek boom'); });
    await expect(op.process(1, makeCtx())).rejects.toBeInstanceOf(NakError);
  });
});

// ─── MergeOperator ────────────────────────────────────────────────────────────

describe('MergeOperator', () => {
  it('passes through each value unchanged', async () => {
    const op = new MergeOperator<number>();
    expect(await op.process(1, makeCtx())).toBe(1);
    expect(await op.process(42, makeCtx())).toBe(42);
  });

  it('passes objects through by reference', async () => {
    const op = new MergeOperator<{ id: number }>();
    const obj = { id: 99 };
    const result = await op.process(obj, makeCtx());
    expect(result).toBe(obj);
  });
});

// ─── BranchOperator ───────────────────────────────────────────────────────────

describe('BranchOperator', () => {
  it('trueBranch passes values satisfying the predicate', async () => {
    const { trueBranch, falseBranch } = new BranchOperator<number>((n) => n > 0);
    expect(await trueBranch.process(5, makeCtx())).toBe(5);
    expect(await trueBranch.process(-1, makeCtx())).toBeUndefined();
    void falseBranch; // ensure both branches exist
  });

  it('falseBranch passes values NOT satisfying the predicate', async () => {
    const { trueBranch, falseBranch } = new BranchOperator<number>((n) => n > 0);
    expect(await falseBranch.process(-1, makeCtx())).toBe(-1);
    expect(await falseBranch.process(5, makeCtx())).toBeUndefined();
    void trueBranch;
  });

  it('supports async predicate in both branches', async () => {
    const { trueBranch, falseBranch } = new BranchOperator<string>(
      async (s) => s.startsWith('a'),
    );
    expect(await trueBranch.process('apple', makeCtx())).toBe('apple');
    expect(await trueBranch.process('banana', makeCtx())).toBeUndefined();
    expect(await falseBranch.process('banana', makeCtx())).toBe('banana');
    expect(await falseBranch.process('apple', makeCtx())).toBeUndefined();
  });

  it('routes every message to exactly one branch', async () => {
    const { trueBranch, falseBranch } = new BranchOperator<number>((n) => n % 2 === 0);
    const values = [1, 2, 3, 4, 5];
    const trueResults: number[] = [];
    const falseResults: number[] = [];
    for (const v of values) {
      const t = await trueBranch.process(v, makeCtx());
      const f = await falseBranch.process(v, makeCtx());
      if (t !== undefined) trueResults.push(t);
      if (f !== undefined) falseResults.push(f);
    }
    expect(trueResults).toEqual([2, 4]);
    expect(falseResults).toEqual([1, 3, 5]);
  });
});

// ─── Chaining operators ───────────────────────────────────────────────────────

describe('Operator chaining', () => {
  it('map then filter produces correct subset', async () => {
    const double = new MapOperator<number, number>((n) => n * 2);
    const keepBig = new FilterOperator<number>((n) => n > 5);

    const results: number[] = [];
    for (const n of [1, 2, 3, 4]) {
      const doubled = await double.process(n, makeCtx());
      const filtered = doubled !== undefined
        ? await keepBig.process(doubled as number, makeCtx())
        : undefined;
      if (filtered !== undefined) results.push(filtered as number);
    }
    expect(results).toEqual([6, 8]);
  });

  it('map then peek then flatMap expands correctly', async () => {
    const wrap = new MapOperator<string, string[]>((s) => [s, s.toUpperCase()]);
    const log: string[][] = [];
    const spy = new PeekOperator<string[]>((arr) => { log.push(arr); });
    const expand = new FlatMapOperator<string[], string>((arr) => arr);

    const input = 'hi';
    const wrapped = await wrap.process(input, makeCtx()) as string[];
    await spy.process(wrapped, makeCtx());
    const flat = await expand.process(wrapped, makeCtx());

    expect(flat).toEqual(['hi', 'HI']);
    expect(log).toEqual([['hi', 'HI']]);
  });
});
