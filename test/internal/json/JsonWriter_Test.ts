import { describe, it, expect, beforeEach } from 'bun:test';
import { JsonWriter } from '@zenystx/core/internal/json/JsonWriter';
import { StringWriter } from '@zenystx/core/internal/json/StringWriter';

function string(...chars: (string | number)[]): string {
  return chars.map(c => typeof c === 'number' ? String.fromCharCode(c) : c).join('');
}

describe('JsonWriter_Test', () => {
  let output: StringWriter;
  let writer: JsonWriter;

  beforeEach(() => {
    output = new StringWriter();
    writer = new JsonWriter(output);
  });

  it('writeLiteral', () => {
    writer.writeLiteral('foo');
    expect(output.toString()).toBe('foo');
  });

  it('writeNumber', () => {
    writer.writeNumber('23');
    expect(output.toString()).toBe('23');
  });

  it('writeString_empty', () => {
    writer.writeString('');
    expect(output.toString()).toBe('""');
  });

  it('writeSting_escapesBackslashes', () => {
    writer.writeString('foo\\bar');
    expect(output.toString()).toBe('"foo\\\\bar"');
  });

  it('writeArrayParts', () => {
    writer.writeArrayOpen();
    writer.writeArraySeparator();
    writer.writeArrayClose();
    expect(output.toString()).toBe('[,]');
  });

  it('writeObjectParts', () => {
    writer.writeObjectOpen();
    writer.writeMemberSeparator();
    writer.writeObjectSeparator();
    writer.writeObjectClose();
    expect(output.toString()).toBe('{:,}');
  });

  it('writeMemberName_empty', () => {
    writer.writeMemberName('');
    expect(output.toString()).toBe('""');
  });

  it('writeMemberName_escapesBackslashes', () => {
    writer.writeMemberName('foo\\bar');
    expect(output.toString()).toBe('"foo\\\\bar"');
  });

  it('escapesQuotes', () => {
    writer.writeString('a"b');
    expect(output.toString()).toBe('"a\\"b"');
  });

  it('escapesEscapedQuotes', () => {
    writer.writeString('foo\\"bar');
    expect(output.toString()).toBe('"foo\\\\\\"bar"');
  });

  it('escapesNewLine', () => {
    writer.writeString('foo\nbar');
    expect(output.toString()).toBe('"foo\\nbar"');
  });

  it('escapesWindowsNewLine', () => {
    writer.writeString('foo\r\nbar');
    expect(output.toString()).toBe('"foo\\r\\nbar"');
  });

  it('escapesTabs', () => {
    writer.writeString('foo\tbar');
    expect(output.toString()).toBe('"foo\\tbar"');
  });

  it('escapesSpecialCharacters', () => {
    writer.writeString('foo\u2028bar\u2029');
    expect(output.toString()).toBe('"foo\\u2028bar\\u2029"');
  });

  it('escapesZeroCharacter', () => {
    writer.writeString(string('f', 'o', 'o', 0, 'b', 'a', 'r'));
    expect(output.toString()).toBe('"foo\\u0000bar"');
  });

  it('escapesEscapeCharacter', () => {
    writer.writeString(string('f', 'o', 'o', 27, 'b', 'a', 'r'));
    expect(output.toString()).toBe('"foo\\u001bbar"');
  });

  it('escapesControlCharacters', () => {
    writer.writeString(string(1, 8, 15, 16, 31));
    expect(output.toString()).toBe('"\\u0001\\u0008\\u000f\\u0010\\u001f"');
  });

  it('escapesFirstChar', () => {
    writer.writeString(string('\\', 'x'));
    expect(output.toString()).toBe('"\\\\x"');
  });

  it('escapesLastChar', () => {
    writer.writeString(string('x', '\\'));
    expect(output.toString()).toBe('"x\\\\"');
  });
});
