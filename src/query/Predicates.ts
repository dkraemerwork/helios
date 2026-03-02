import type { Predicate } from './Predicate';
import { TruePredicate } from './impl/predicates/TruePredicate';
import { FalsePredicate } from './impl/predicates/FalsePredicate';
import { EqualPredicate } from './impl/predicates/EqualPredicate';
import { NotEqualPredicate } from './impl/predicates/NotEqualPredicate';
import { GreaterLessPredicate } from './impl/predicates/GreaterLessPredicate';
import { BetweenPredicate } from './impl/predicates/BetweenPredicate';
import { InPredicate } from './impl/predicates/InPredicate';
import { LikePredicate } from './impl/predicates/LikePredicate';
import { ILikePredicate } from './impl/predicates/ILikePredicate';
import { RegexPredicate } from './impl/predicates/RegexPredicate';
import { AndPredicate } from './impl/predicates/AndPredicate';
import { OrPredicate } from './impl/predicates/OrPredicate';
import { NotPredicate } from './impl/predicates/NotPredicate';

/**
 * Factory class for creating predicates.
 * Equivalent to Java's Predicates utility class.
 */
export class Predicates {
  private constructor() {}

  static alwaysTrue<K = unknown, V = unknown>(): Predicate<K, V> {
    return TruePredicate.INSTANCE as TruePredicate<K, V>;
  }

  static alwaysFalse<K = unknown, V = unknown>(): Predicate<K, V> {
    return FalsePredicate.INSTANCE as FalsePredicate<K, V>;
  }

  static equal<K = unknown, V = unknown>(attribute: string, value: unknown): Predicate<K, V> {
    return new EqualPredicate<K, V>(attribute, value);
  }

  static notEqual<K = unknown, V = unknown>(attribute: string, value: unknown): Predicate<K, V> {
    return new NotEqualPredicate<K, V>(attribute, value);
  }

  static greaterThan<K = unknown, V = unknown>(attribute: string, value: unknown): Predicate<K, V> {
    return new GreaterLessPredicate<K, V>(attribute, value, false, false);
  }

  static greaterEqual<K = unknown, V = unknown>(attribute: string, value: unknown): Predicate<K, V> {
    return new GreaterLessPredicate<K, V>(attribute, value, true, false);
  }

  static lessThan<K = unknown, V = unknown>(attribute: string, value: unknown): Predicate<K, V> {
    return new GreaterLessPredicate<K, V>(attribute, value, false, true);
  }

  static lessEqual<K = unknown, V = unknown>(attribute: string, value: unknown): Predicate<K, V> {
    return new GreaterLessPredicate<K, V>(attribute, value, true, true);
  }

  static between<K = unknown, V = unknown>(attribute: string, from: unknown, to: unknown): Predicate<K, V> {
    return new BetweenPredicate<K, V>(attribute, from, to);
  }

  static in<K = unknown, V = unknown>(attribute: string, ...values: unknown[]): Predicate<K, V> {
    return new InPredicate<K, V>(attribute, ...values);
  }

  static like<K = unknown, V = unknown>(attribute: string, expression: string): Predicate<K, V> {
    return new LikePredicate<K, V>(attribute, expression);
  }

  static ilike<K = unknown, V = unknown>(attribute: string, expression: string): Predicate<K, V> {
    return new ILikePredicate<K, V>(attribute, expression);
  }

  static regex<K = unknown, V = unknown>(attribute: string, regex: string): Predicate<K, V> {
    return new RegexPredicate<K, V>(attribute, regex);
  }

  static and<K = unknown, V = unknown>(...predicates: Predicate<K, V>[]): Predicate<K, V> {
    return new AndPredicate<K, V>(predicates);
  }

  static or<K = unknown, V = unknown>(...predicates: Predicate<K, V>[]): Predicate<K, V> {
    return new OrPredicate<K, V>(predicates);
  }

  static not<K = unknown, V = unknown>(predicate: Predicate<K, V>): Predicate<K, V> {
    return new NotPredicate<K, V>(predicate);
  }
}
