import { AbstractPredicate } from './AbstractPredicate';

/**
 * Predicate for Java regex matching.
 * Equivalent to Java's RegexPredicate.
 */
export class RegexPredicate<K = unknown, V = unknown> extends AbstractPredicate<K, V> {

  private regex: string;
  private _pattern: RegExp | null = null;

  constructor(attributeName?: string, regex?: string) {
    super(attributeName);
    this.regex = regex ?? '';
  }

  protected override applyForSingleAttributeValue(attributeValue: unknown): boolean {
    if (attributeValue === null || attributeValue === undefined) {
      return false;
    }
    if (this._pattern === null) {
      this._pattern = new RegExp(this.regex);
    }
    return this._pattern.test(String(attributeValue));
  }

  toString(): string {
    return `${this.attributeName} REGEX '${this.regex}'`;
  }
}
