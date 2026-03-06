import { describe, it, expect, beforeEach } from 'bun:test';
import { JsonEscape } from '@zenystx/core/internal/json/JsonEscape';

function string(...chars: (string | number)[]): string {
  return chars.map(c => typeof c === 'number' ? String.fromCharCode(c) : c).join('');
}

describe('JsonEscape_Test', () => {
  let buf: string[];

  beforeEach(() => {
    buf = [];
  });

  it('writeMemberName_escapesBackslashes', () => {
    JsonEscape.writeEscaped(buf, 'foo\\bar');
    expect(buf.join('')).toBe('"foo\\\\bar"');
  });

  it('escapesQuotes', () => {
    JsonEscape.writeEscaped(buf, 'a"b');
    expect(buf.join('')).toBe('"a\\"b"');
  });

  it('escapesEscapedQuotes', () => {
    JsonEscape.writeEscaped(buf, 'foo\\"bar');
    expect(buf.join('')).toBe('"foo\\\\\\"bar"');
  });

  it('escapesNewLine', () => {
    JsonEscape.writeEscaped(buf, 'foo\nbar');
    expect(buf.join('')).toBe('"foo\\nbar"');
  });

  it('escapesWindowsNewLine', () => {
    JsonEscape.writeEscaped(buf, 'foo\r\nbar');
    expect(buf.join('')).toBe('"foo\\r\\nbar"');
  });

  it('escapesTabs', () => {
    JsonEscape.writeEscaped(buf, 'foo\tbar');
    expect(buf.join('')).toBe('"foo\\tbar"');
  });

  it('escapesSpecialCharacters', () => {
    JsonEscape.writeEscaped(buf, 'foo\u2028bar\u2029');
    expect(buf.join('')).toBe('"foo\\u2028bar\\u2029"');
  });

  it('escapesZeroCharacter', () => {
    JsonEscape.writeEscaped(buf, string('f', 'o', 'o', 0, 'b', 'a', 'r'));
    expect(buf.join('')).toBe('"foo\\u0000bar"');
  });

  it('escapesEscapeCharacter', () => {
    JsonEscape.writeEscaped(buf, string('f', 'o', 'o', 27, 'b', 'a', 'r'));
    expect(buf.join('')).toBe('"foo\\u001bbar"');
  });

  it('escapesControlCharacters', () => {
    JsonEscape.writeEscaped(buf, string(1, 8, 15, 16, 31));
    expect(buf.join('')).toBe('"\\u0001\\u0008\\u000f\\u0010\\u001f"');
  });

  it('escapesFirstChar', () => {
    JsonEscape.writeEscaped(buf, string('\\', 'x'));
    expect(buf.join('')).toBe('"\\\\x"');
  });

  it('escapesLastChar', () => {
    JsonEscape.writeEscaped(buf, string('x', '\\'));
    expect(buf.join('')).toBe('"x\\\\"');
  });

  it('escapesEscapeChar', () => {
    JsonEscape.writeEscapedChar(buf, '\\');
    expect(buf.join('')).toBe('"\\\\\"');
  });

  it('escapesNewLineChar', () => {
    JsonEscape.writeEscapedChar(buf, '\n');
    expect(buf.join('')).toBe('"\\n"');
  });
});
