import { describe, it, expect } from 'bun:test';
import { Json } from '@helios/internal/json/Json';
import { JsonArray } from '@helios/internal/json/JsonArray';
import { StringWriter } from '@helios/internal/json/StringWriter';
import { JsonWriter } from '@helios/internal/json/JsonWriter';

const { NULL, TRUE, FALSE } = Json;

describe('JsonLiteral_Test', () => {
  it('isNull', () => {
    expect(NULL.isNull()).toBe(true);
    expect(TRUE.isNull()).toBe(false);
    expect(FALSE.isNull()).toBe(false);
  });

  it('isTrue', () => {
    expect(TRUE.isTrue()).toBe(true);
    expect(NULL.isTrue()).toBe(false);
    expect(FALSE.isTrue()).toBe(false);
  });

  it('isFalse', () => {
    expect(FALSE.isFalse()).toBe(true);
    expect(NULL.isFalse()).toBe(false);
    expect(TRUE.isFalse()).toBe(false);
  });

  it('isBoolean', () => {
    expect(TRUE.isBoolean()).toBe(true);
    expect(FALSE.isBoolean()).toBe(true);
    expect(NULL.isBoolean()).toBe(false);
  });

  it('NULL_write', () => {
    const sw = new StringWriter();
    NULL.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('null');
  });

  it('TRUE_write', () => {
    const sw = new StringWriter();
    TRUE.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('true');
  });

  it('FALSE_write', () => {
    const sw = new StringWriter();
    FALSE.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('false');
  });

  it('NULL_toString', () => {
    expect(NULL.toString()).toBe('null');
  });

  it('TRUE_toString', () => {
    expect(TRUE.toString()).toBe('true');
  });

  it('FALSE_toString', () => {
    expect(FALSE.toString()).toBe('false');
  });

  it('NULL_equals', () => {
    expect((NULL as unknown as { equals(o: unknown): boolean }).equals(NULL)).toBe(true);
    expect((NULL as unknown as { equals(o: unknown): boolean }).equals(null)).toBe(false);
    expect((NULL as unknown as { equals(o: unknown): boolean }).equals(TRUE)).toBe(false);
    expect((NULL as unknown as { equals(o: unknown): boolean }).equals(FALSE)).toBe(false);
    expect((NULL as unknown as { equals(o: unknown): boolean }).equals(Json.value('null'))).toBe(false);
  });

  it('TRUE_equals', () => {
    expect((TRUE as unknown as { equals(o: unknown): boolean }).equals(TRUE)).toBe(true);
    expect((TRUE as unknown as { equals(o: unknown): boolean }).equals(null)).toBe(false);
    expect((TRUE as unknown as { equals(o: unknown): boolean }).equals(FALSE)).toBe(false);
  });

  it('FALSE_equals', () => {
    expect((FALSE as unknown as { equals(o: unknown): boolean }).equals(FALSE)).toBe(true);
    expect((FALSE as unknown as { equals(o: unknown): boolean }).equals(null)).toBe(false);
    expect((FALSE as unknown as { equals(o: unknown): boolean }).equals(TRUE)).toBe(false);
  });
});
