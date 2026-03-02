import type { QueryContext } from '../QueryContext';
import { LikePredicate } from './LikePredicate';

/**
 * Case-insensitive LIKE predicate.
 * Adds Pattern.CASE_INSENSITIVE | UNICODE_CASE flags.
 * Equivalent to Java's ILikePredicate.
 */
export class ILikePredicate<K = unknown, V = unknown> extends LikePredicate<K, V> {

  constructor(attributeName?: string, expression?: string) {
    super(attributeName, expression);
  }

  protected override _getFlags(): string {
    return 'siu'; // DOTALL + CASE_INSENSITIVE + UNICODE
  }

  /** ILike is never indexed (overrides parent). */
  override isIndexed(_queryContext: QueryContext): boolean {
    return false;
  }
}
