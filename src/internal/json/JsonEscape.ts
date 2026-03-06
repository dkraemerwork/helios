import { JsonWriter } from '@zenystx/core/internal/json/JsonWriter';

/** Utility for writing JSON-escaped strings into a StringBuilder. */
export class JsonEscape {
  private constructor() {}

  /** Write {@code source} as a JSON string (with surrounding quotes) into {@code target}. */
  static writeEscaped(target: string[], source: string): void;
  static writeEscaped(target: string[], source: string | string[]): void {
    if (Array.isArray(source)) {
      // single-char overload: source is a string array of one char
      target.push('"');
      const ch = source[0];
      const replacement = JsonWriter.getReplacementChars(ch.charCodeAt(0));
      if (replacement !== null) target.push(replacement);
      else target.push(ch);
      target.push('"');
    } else {
      target.push('"');
      let start = 0;
      const length = source.length;
      for (let index = 0; index < length; index++) {
        const replacement = JsonWriter.getReplacementChars(source.charCodeAt(index));
        if (replacement !== null) {
          target.push(source.substring(start, index));
          target.push(replacement);
          start = index + 1;
        }
      }
      target.push(source.substring(start));
      target.push('"');
    }
  }

  /** Write a single char {@code c} as a JSON string (with surrounding quotes) into {@code target}. */
  static writeEscapedChar(target: string[], c: string): void {
    target.push('"');
    const replacement = JsonWriter.getReplacementChars(c.charCodeAt(0));
    if (replacement !== null) target.push(replacement);
    else target.push(c);
    target.push('"');
  }
}
