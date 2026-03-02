import { describe, test, expect } from 'bun:test';
import { GreaterLessPredicate } from '@helios/query/impl/predicates/GreaterLessPredicate';
import { entry } from './PredicateTestUtils';

describe('GreaterLessPredicate', () => {

  test('negate_whenEqualsTrueAndLessTrue_thenReturnNewInstanceWithEqualsFalseAndLessFalse', () => {
    const attribute = 'attribute';
    const value = 1;
    const original = new GreaterLessPredicate(attribute, value, true, true);
    const negate = original.negate() as GreaterLessPredicate;

    expect(negate).not.toBe(original);
    expect(negate).toBeInstanceOf(GreaterLessPredicate);
    expect(negate.attributeName).toBe(attribute);
    expect(negate.equal).toBe(false);
    expect(negate.less).toBe(false);
  });

  test('negate_whenEqualsFalseAndLessFalse_thenReturnNewInstanceWithEqualsTrueAndLessTrue', () => {
    const attribute = 'attribute';
    const value = 1;
    const original = new GreaterLessPredicate(attribute, value, false, false);
    const negate = original.negate() as GreaterLessPredicate;

    expect(negate).not.toBe(original);
    expect(negate.attributeName).toBe(attribute);
    expect(negate.equal).toBe(true);
    expect(negate.less).toBe(true);
  });

  test('negate_whenEqualsTrueAndLessFalse_thenReturnNewInstanceWithEqualsFalseAndLessTrue', () => {
    const attribute = 'attribute';
    const value = 1;
    const original = new GreaterLessPredicate(attribute, value, true, false);
    const negate = original.negate() as GreaterLessPredicate;

    expect(negate).not.toBe(original);
    expect(negate.attributeName).toBe(attribute);
    expect(negate.equal).toBe(false);
    expect(negate.less).toBe(true);
  });

  test('negate_whenEqualsFalseAndLessTrue_thenReturnNewInstanceWithEqualsTrueAndLessFalse', () => {
    const attribute = 'attribute';
    const value = 1;
    const original = new GreaterLessPredicate(attribute, value, false, true);
    const negate = original.negate() as GreaterLessPredicate;

    expect(negate).not.toBe(original);
    expect(negate.attributeName).toBe(attribute);
    expect(negate.equal).toBe(true);
    expect(negate.less).toBe(false);
  });

  // Java issue #6188: 0.0 >= -0.0 should be FALSE (not equal, not greater)
  test('equal_zeroMinusZero', () => {
    const equal = true;
    const less = false; // >= check

    expect(new GreaterLessPredicate('this', 0.0, equal, less).apply(entry(-0.0))).toBe(false);
    expect(new GreaterLessPredicate('this', 0.0, equal, less).apply(entry(-0.0))).toBe(false);
    expect(new GreaterLessPredicate('this', 0.0, equal, less).apply(entry(-0.0))).toBe(false);
    expect(new GreaterLessPredicate('this', 0.0, equal, less).apply(entry(-0.0))).toBe(false);

    // In JS, 0.0 === -0.0
  });

  // Java issue #6188: NaN >= NaN should be TRUE (NaN equals NaN in predicate semantics)
  test('equal_NaN', () => {
    const equal = true;
    const less = false; // >= check

    expect(new GreaterLessPredicate('this', NaN, equal, less).apply(entry(NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', NaN, equal, less).apply(entry(NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', NaN, equal, less).apply(entry(-NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', NaN, equal, less).apply(entry(-NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', NaN, equal, less).apply(entry(-NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', NaN, equal, less).apply(entry(-NaN))).toBe(true);

    // In JS: NaN !== NaN
  });

  // NaN is treated as greater than any number in predicate comparisons
  test('greaterThan', () => {
    const equal = true;

    // NaN >= 100.0 → true (NaN is greatest)
    expect(new GreaterLessPredicate('this', 100.0, equal, false).apply(entry(NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', 100.0, equal, false).apply(entry(NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', 100.0, equal, false).apply(entry(NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', 100.0, equal, false).apply(entry(NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', 100.0, equal, false).apply(entry(-NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', 100.0, equal, false).apply(entry(-NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', 100.0, equal, false).apply(entry(-NaN))).toBe(true);
    expect(new GreaterLessPredicate('this', 100.0, equal, false).apply(entry(-NaN))).toBe(true);

    // NaN <= -100.0 → false (NaN is greatest, not least)
    expect(new GreaterLessPredicate('this', -100.0, equal, true).apply(entry(-NaN))).toBe(false);
    expect(new GreaterLessPredicate('this', -100.0, equal, true).apply(entry(-NaN))).toBe(false);
    expect(new GreaterLessPredicate('this', -100.0, equal, true).apply(entry(-NaN))).toBe(false);
    expect(new GreaterLessPredicate('this', -100.0, equal, true).apply(entry(-NaN))).toBe(false);

    // In JS: NaN > 100.0 → false (normal JS semantics)
    expect(NaN > 100.0).toBe(false);
  });
});
