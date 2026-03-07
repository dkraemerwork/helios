import type { Index } from '../Index';
import type { QueryContext } from '../QueryContext';
import { IndexMatchHint } from '../QueryContext';
import { AbstractPredicate } from './AbstractPredicate';

/**
 * Extends AbstractPredicate with the ability to use indexes.
 * Equivalent to Java's AbstractIndexAwarePredicate.
 */
export abstract class AbstractIndexAwarePredicate<K = unknown, V = unknown>
  extends AbstractPredicate<K, V> {

  protected constructor(attributeName?: string) {
    super(attributeName);
  }

  protected matchIndex(queryContext: QueryContext, hint: IndexMatchHint): Index | null {
    return queryContext.matchIndex(this.attributeName, hint);
  }

  isIndexed(queryContext: QueryContext): boolean {
    return this.matchIndex(queryContext, IndexMatchHint.PREFER_UNORDERED) !== null;
  }
}
