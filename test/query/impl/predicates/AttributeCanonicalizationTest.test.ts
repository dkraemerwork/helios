import { describe, test, expect } from 'bun:test';
import { canonicalizeAttribute } from '@zenystx/core/query/impl/IndexUtils';
import { AbstractPredicate } from '@zenystx/core/query/impl/predicates/AbstractPredicate';

/** Minimal concrete predicate for testing AbstractPredicate canonicalization. */
class TestPredicate extends AbstractPredicate {
  constructor(attribute: string) {
    super(attribute);
  }
  getClassId(): number { return 0; }
  protected applyForSingleAttributeValue(_value: unknown): boolean { return false; }
}

describe('AttributeCanonicalization', () => {

  test('testAttributes', () => {
    expect(canonicalizeAttribute('foo')).toBe('foo');
    expect(canonicalizeAttribute('this.foo')).toBe('foo');
    expect(canonicalizeAttribute('this')).toBe('this');
    expect(canonicalizeAttribute('foo.this.bar')).toBe('foo.this.bar');
    expect(canonicalizeAttribute('this.foo.bar')).toBe('foo.bar');
    expect(canonicalizeAttribute('foo.bar')).toBe('foo.bar');
    expect(canonicalizeAttribute('__key')).toBe('__key');
    expect(canonicalizeAttribute('__key.foo')).toBe('__key.foo');
  });

  test('testAbstractPredicate', () => {
    expect(new TestPredicate('foo').attributeName).toBe('foo');
    expect(new TestPredicate('this.foo').attributeName).toBe('foo');
    expect(new TestPredicate('this').attributeName).toBe('this');
    expect(new TestPredicate('foo.this.bar').attributeName).toBe('foo.this.bar');
    expect(new TestPredicate('this.foo.bar').attributeName).toBe('foo.bar');
    expect(new TestPredicate('foo.bar').attributeName).toBe('foo.bar');
    expect(new TestPredicate('__key').attributeName).toBe('__key');
    expect(new TestPredicate('__key.foo').attributeName).toBe('__key.foo');
  });
});
