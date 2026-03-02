/**
 * Represents an entry that can be queried by attribute name.
 * Equivalent to Java's QueryableEntry / Extractable interface pair.
 */
export interface QueryableEntry<K = unknown, V = unknown> {
  getKey(): K;
  getValue(): V;
  /** Extract value for the given attribute name, e.g. "this", "__key", "field.nested". */
  getAttributeValue(attribute: string): unknown;
}
