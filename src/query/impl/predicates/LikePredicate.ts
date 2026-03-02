import type { QueryContext } from '../QueryContext';
import { IndexMatchHint } from '../QueryContext';
import { IndexType } from '../Index';
import { AbstractPredicate } from './AbstractPredicate';

/**
 * Predicate implementing SQL LIKE pattern matching.
 * Wildcards: % (zero or more chars), _ (exactly one char).
 * Escape character: \ (backslash).
 * Equivalent to Java's LikePredicate.
 */
export class LikePredicate<K = unknown, V = unknown> extends AbstractPredicate<K, V> {

  protected expression: string;
  private _pattern: RegExp | null = null;

  constructor(attributeName?: string, expression?: string) {
    super(attributeName);
    this.expression = expression ?? '';
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    if (attributeValue === null || attributeValue === undefined) {
      return false;
    }
    if (this._pattern === null) {
      this._pattern = this._createPattern();
    }
    return this._pattern.test(String(attributeValue));
  }

  private _createPattern(): RegExp {
    const expr = this.expression;
    const n = expr.length;
    let result = '';
    let i = 0;
    while (i < n) {
      const c = expr[i];
      if (c === '\\' && i + 1 < n) {
        const next = expr[i + 1]!;
        result += _escapeRegex(next);
        i += 2;
      } else if (c === '%') {
        result += '.*';
        i++;
      } else if (c === '_') {
        result += '.';
        i++;
      } else {
        result += _escapeRegex(c);
        i++;
      }
    }
    return new RegExp('^' + result + '$', this._getFlags());
  }

  /** Override in ILikePredicate to add case-insensitive flags. */
  protected _getFlags(): string {
    return 's'; // DOTALL: '.' matches newlines
  }

  /**
   * Returns true if the LIKE expression ends with an unescaped % and
   * the prefix before it contains no unescaped wildcards — meaning a
   * sorted index prefix scan is possible.
   */
  expressionCanBeUsedAsIndexPrefix(): boolean {
    const expr = this.expression;
    const n = expr.length;

    // Find last unescaped '%'
    let lastUnescapedPercent = -1;
    let i = 0;
    while (i < n) {
      const c = expr[i];
      if (c === '\\' && i + 1 < n) {
        i += 2; // skip escaped char
      } else if (c === '%') {
        lastUnescapedPercent = i;
        i++;
      } else {
        i++;
      }
    }

    if (lastUnescapedPercent === -1) return false;       // no unescaped %
    if (lastUnescapedPercent !== n - 1) return false;    // % is not at end

    // Check prefix [0, lastUnescapedPercent) for unescaped wildcards
    let j = 0;
    while (j < lastUnescapedPercent) {
      const c = expr[j];
      if (c === '\\' && j + 1 < lastUnescapedPercent) {
        j += 2; // skip escaped char
      } else if (c === '%' || c === '_') {
        return false; // unescaped wildcard in prefix
      } else {
        j++;
      }
    }
    return true;
  }

  isIndexed(queryContext: QueryContext): boolean {
    const index = queryContext.matchIndex(this.attributeName, IndexMatchHint.PREFER_ORDERED);
    if (index === null) return false;
    const type = index.getConfig().getType();
    if (type === IndexType.SORTED) {
      return this.expressionCanBeUsedAsIndexPrefix();
    }
    return false;
  }

  toString(): string {
    return `${this.attributeName} LIKE '${this.expression}'`;
  }
}

function _escapeRegex(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
