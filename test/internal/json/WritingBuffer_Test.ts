import { describe, it, expect, beforeEach } from 'bun:test';
import { WritingBuffer } from '@zenystx/helios-core/internal/json/WritingBuffer';
import { StringWriter } from '@zenystx/helios-core/internal/json/StringWriter';

const BUFFER_SIZE = 16;

function createString(length: number): string {
  return 'x'.repeat(length);
}

describe('WritingBuffer_Test', () => {
  let wrapped: StringWriter;
  let writer: WritingBuffer;

  beforeEach(() => {
    wrapped = new StringWriter();
    writer = new WritingBuffer(wrapped, BUFFER_SIZE);
  });

  it('testFlushEmpty', () => {
    writer.flush();
    expect(wrapped.toString()).toBe('');
  });

  it('testWriteChar', () => {
    writer.writeInt('c'.charCodeAt(0));
    writer.flush();
    expect(wrapped.toString()).toBe('c');
  });

  it('testWriteChar_fit', () => {
    writer.writeStr(createString(BUFFER_SIZE - 1));
    writer.writeInt('c'.charCodeAt(0));
    writer.flush();
    expect(wrapped.toString()).toBe(createString(BUFFER_SIZE - 1) + 'c');
  });

  it('testWriteChar_exceeding', () => {
    writer.writeStr(createString(BUFFER_SIZE));
    writer.writeInt('c'.charCodeAt(0));
    writer.flush();
    expect(wrapped.toString()).toBe(createString(BUFFER_SIZE) + 'c');
  });

  it('testWriteCharArray', () => {
    writer.writeSub('foobar', 1, 3);
    writer.flush();
    expect(wrapped.toString()).toBe('oob');
  });

  it('testWriteCharArray_fit', () => {
    writer.writeStr(createString(BUFFER_SIZE - 3));
    writer.writeSub('foobar', 1, 3);
    writer.flush();
    expect(wrapped.toString()).toBe(createString(BUFFER_SIZE - 3) + 'oob');
  });

  it('testWriteCharArray_exceeding', () => {
    writer.writeStr(createString(BUFFER_SIZE - 2));
    writer.writeSub('foobar', 1, 3);
    writer.flush();
    expect(wrapped.toString()).toBe(createString(BUFFER_SIZE - 2) + 'oob');
  });

  it('testWriteCharArray_exceedingBuffer', () => {
    writer.writeSub(createString(BUFFER_SIZE + 1), 0, BUFFER_SIZE + 1);
    writer.flush();
    expect(wrapped.toString()).toBe(createString(BUFFER_SIZE + 1));
  });

  it('testWriteString', () => {
    writer.writeSub('foobar', 1, 3);
    writer.flush();
    expect(wrapped.toString()).toBe('oob');
  });

  it('testWriteString_fit', () => {
    writer.writeStr(createString(BUFFER_SIZE - 3));
    writer.writeSub('foobar', 1, 3);
    writer.flush();
    expect(wrapped.toString()).toBe(createString(BUFFER_SIZE - 3) + 'oob');
  });

  it('testWriteString_exceeding', () => {
    writer.writeStr(createString(BUFFER_SIZE - 2));
    writer.writeSub('foobar', 1, 3);
    writer.flush();
    expect(wrapped.toString()).toBe(createString(BUFFER_SIZE - 2) + 'oob');
  });

  it('testWriteString_exceedingBuffer', () => {
    writer.writeSub(createString(BUFFER_SIZE + 1), 0, BUFFER_SIZE + 1);
    writer.flush();
    expect(wrapped.toString()).toBe(createString(BUFFER_SIZE + 1));
  });
});
