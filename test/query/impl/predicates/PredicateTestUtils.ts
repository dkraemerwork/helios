import type { Predicate } from '@zenystx/core/query/Predicate';
import type { QueryableEntry } from '@zenystx/core/query/impl/QueryableEntry';
import type { IndexRegistry } from '@zenystx/core/query/impl/IndexRegistry';
import type { Visitor } from '@zenystx/core/query/impl/predicates/Visitor';
import type { NegatablePredicate } from '@zenystx/core/query/impl/predicates/NegatablePredicate';
import type { VisitablePredicate } from '@zenystx/core/query/impl/predicates/VisitablePredicate';
import { AbstractVisitor } from '@zenystx/core/query/impl/predicates/AbstractVisitor';

/**
 * Creates a simple QueryableEntry that returns `value` for "this" attribute
 * and `undefined` for all other attributes.
 * Mirrors Java's PredicateTestUtils.entry(value).
 */
export function entry<V>(value: V): QueryableEntry<unknown, V> {
  return {
    getKey: () => 'test-key',
    getValue: () => value,
    getAttributeValue: (attr: string): unknown => {
      if (attr === 'this') return value;
      if (value !== null && value !== undefined && typeof value === 'object') {
        return (value as Record<string, unknown>)[attr] ?? null;
      }
      return null;
    },
  };
}

/**
 * Creates a mock predicate that implements NegatablePredicate.
 * The negate() call returns the given `negation` predicate.
 */
export function createMockNegatablePredicate<K = unknown, V = unknown>(
  negation: Predicate<K, V>,
): Predicate<K, V> & NegatablePredicate<K, V> {
  return {
    apply: (_e: QueryableEntry<K, V>) => false,
    negate: () => negation,
  };
}

/**
 * Creates a mock predicate that implements VisitablePredicate.
 * The accept() call returns itself (no-op transformation).
 */
export function createMockVisitablePredicate<K = unknown, V = unknown>(): Predicate<K, V> & VisitablePredicate<K, V>;
/**
 * Creates a mock predicate that implements VisitablePredicate.
 * The accept() call returns `transformed`.
 */
export function createMockVisitablePredicate<K = unknown, V = unknown>(
  transformed: Predicate<K, V>,
): Predicate<K, V> & VisitablePredicate<K, V>;
export function createMockVisitablePredicate<K = unknown, V = unknown>(
  transformed?: Predicate<K, V>,
): Predicate<K, V> & VisitablePredicate<K, V> {
  const p: Predicate<K, V> & VisitablePredicate<K, V> = {
    apply: (_e: QueryableEntry<K, V>) => false,
    accept: (_visitor: Visitor, _indexes: IndexRegistry): Predicate<K, V> =>
      transformed !== undefined ? transformed : p,
  };
  return p;
}

/**
 * Visitor that passes every predicate through unchanged (returns the first argument).
 * Mirrors Java's PredicateTestUtils.createPassthroughVisitor().
 */
export function createPassthroughVisitor(): Visitor {
  return new AbstractVisitor();
}

/**
 * Visitor that replaces every And/Or/Not with `delegate`.
 * Mirrors Java's PredicateTestUtils.createDelegatingVisitor(delegate).
 */
export function createDelegatingVisitor<K = unknown, V = unknown>(delegate: Predicate<K, V>): Visitor {
  return {
    visitAnd: (_p, _idx) => delegate as Predicate,
    visitOr:  (_p, _idx) => delegate as Predicate,
    visitNot: (_p, _idx) => delegate as Predicate,
    visitEqual:    (p, _idx) => p,
    visitNotEqual: (p, _idx) => p,
    visitIn:       (p, _idx) => p,
    visitBetween:  (p, _idx) => p,
  };
}
