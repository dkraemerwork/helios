import { describe, it, expect } from 'bun:test';
import { Preconditions } from '@zenystx/core/internal/util/Preconditions';

describe('PreconditionsTest', () => {
  it('checkNotNull_whenNull', () => {
    const msg = "Can't be null";
    expect(() => Preconditions.checkNotNull(null, msg)).toThrow(msg);
  });

  it('checkNotNull_whenNotNull', () => {
    const o = 'foobar';
    const result = Preconditions.checkNotNull(o, '');
    expect(result).toBe(o);
  });

  it('checkTrue_whenTrue', () => {
    expect(() => Preconditions.checkTrue(true, 'msg')).not.toThrow();
  });

  it('checkTrue_whenFalse', () => {
    expect(() => Preconditions.checkTrue(false, 'error')).toThrow('error');
  });

  it('checkFalse_whenFalse', () => {
    expect(() => Preconditions.checkFalse(false, 'msg')).not.toThrow();
  });

  it('checkFalse_whenTrue', () => {
    expect(() => Preconditions.checkFalse(true, 'error')).toThrow('error');
  });

  it('checkNotNegative_whenNegative', () => {
    expect(() => Preconditions.checkNotNegative(-1, 'negative')).toThrow('negative');
  });

  it('checkNotNegative_whenZero', () => {
    expect(Preconditions.checkNotNegative(0, 'err')).toEqual(0);
  });

  it('checkPositive_whenZero', () => {
    expect(() => Preconditions.checkPositive(0, 'zero')).toThrow('zero');
  });

  it('checkPositive_whenPositive', () => {
    expect(Preconditions.checkPositive(1, 'err')).toEqual(1);
  });

  it('isNotNull_whenNull', () => {
    expect(() => Preconditions.isNotNull(null, 'argName')).toThrow("argument 'argName' can't be null");
  });

  it('checkHasText_whenEmpty', () => {
    expect(() => Preconditions.checkHasText('', 'no text')).toThrow('no text');
  });

  it('checkHasText_whenHasText', () => {
    expect(Preconditions.checkHasText('hello', '')).toEqual('hello');
  });
});
