/** Pattern that strips the "this." prefix from attribute names. */
const THIS_PREFIX = /^this\./;

/**
 * Produces canonical attribute representation by stripping an unnecessary
 * "this." qualifier from the passed attribute, if any.
 *
 * Examples:
 *   "foo"           → "foo"
 *   "this.foo"      → "foo"
 *   "this"          → "this"
 *   "foo.this.bar"  → "foo.this.bar"
 *   "this.foo.bar"  → "foo.bar"
 *   "__key"         → "__key"
 */
export function canonicalizeAttribute(attribute: string): string {
  return attribute.replace(THIS_PREFIX, '');
}
