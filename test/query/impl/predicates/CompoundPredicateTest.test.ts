import { describe, test, expect } from 'bun:test';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import { Predicates } from '@zenystx/helios-core/query/Predicates';
import { AndPredicate } from '@zenystx/helios-core/query/impl/predicates/AndPredicate';
import { OrPredicate } from '@zenystx/helios-core/query/impl/predicates/OrPredicate';
import type { CompoundPredicate } from '@zenystx/helios-core/query/impl/predicates/CompoundPredicate';

type CompoundPredicateCtor = new () => CompoundPredicate;

const implementations: [string, CompoundPredicateCtor][] = [
  ['AndPredicate', AndPredicate as unknown as CompoundPredicateCtor],
  ['OrPredicate',  OrPredicate  as unknown as CompoundPredicateCtor],
];

describe('CompoundPredicate', () => {
  for (const [name, Klass] of implementations) {

    test(`${name}: test_newInstance`, () => {
      const o = new Klass();
      expect(o).toBeDefined();
      expect(typeof o.getPredicates).toBe('function');
      expect(typeof o.setPredicates).toBe('function');
    });

    test(`${name}: test_whenSetPredicatesOnNewInstance`, () => {
      const o = new Klass();
      const truePredicate: Predicate = Predicates.alwaysTrue();
      o.setPredicates([truePredicate]);
      expect(o.getPredicates()[0]).toBe(truePredicate);
    });

    test(`${name}: test_whenSetPredicatesOnExistingPredicates_thenThrowException`, () => {
      const o = new Klass();
      const truePredicate: Predicate = Predicates.alwaysTrue();
      o.setPredicates([truePredicate]);

      const falsePredicate: Predicate = Predicates.alwaysFalse();
      expect(() => o.setPredicates([falsePredicate])).toThrow();
    });
  }
});
