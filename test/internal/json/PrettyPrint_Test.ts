import { describe, it, expect, beforeEach } from 'bun:test';
import { JsonArray } from '@zenystx/core/internal/json/JsonArray';
import { JsonObject } from '@zenystx/core/internal/json/JsonObject';
import { PrettyPrint } from '@zenystx/core/internal/json/PrettyPrint';
import { StringWriter } from '@zenystx/core/internal/json/StringWriter';

describe('PrettyPrint_Test', () => {
  let output: StringWriter;

  beforeEach(() => {
    output = new StringWriter();
  });

  it('testIndentWithSpaces_emptyArray', () => {
    new JsonArray().writeTo(output, PrettyPrint.indentWithSpaces(2));
    expect(output.toString()).toBe('[\n  \n]');
  });

  it('testIndentWithSpaces_emptyObject', () => {
    new JsonObject().writeTo(output, PrettyPrint.indentWithSpaces(2));
    expect(output.toString()).toBe('{\n  \n}');
  });

  it('testIndentWithSpaces_array', () => {
    new JsonArray().add(23).add(42).writeTo(output, PrettyPrint.indentWithSpaces(2));
    expect(output.toString()).toBe('[\n  23,\n  42\n]');
  });

  it('testIndentWithSpaces_nestedArray', () => {
    new JsonArray().add(23).add(new JsonArray().add(42)).writeTo(output, PrettyPrint.indentWithSpaces(2));
    expect(output.toString()).toBe('[\n  23,\n  [\n    42\n  ]\n]');
  });

  it('testIndentWithSpaces_object', () => {
    new JsonObject().add('a', 23).add('b', 42).writeTo(output, PrettyPrint.indentWithSpaces(2));
    expect(output.toString()).toBe('{\n  "a": 23,\n  "b": 42\n}');
  });

  it('testIndentWithSpaces_nestedObject', () => {
    new JsonObject()
      .add('a', 23)
      .add('b', new JsonObject().add('c', 42))
      .writeTo(output, PrettyPrint.indentWithSpaces(2));
    expect(output.toString()).toBe('{\n  "a": 23,\n  "b": {\n    "c": 42\n  }\n}');
  });

  it('testIndentWithSpaces_zero', () => {
    new JsonArray().add(23).add(42).writeTo(output, PrettyPrint.indentWithSpaces(0));
    expect(output.toString()).toBe('[\n23,\n42\n]');
  });

  it('testIndentWithSpaces_one', () => {
    new JsonArray().add(23).add(42).writeTo(output, PrettyPrint.indentWithSpaces(1));
    expect(output.toString()).toBe('[\n 23,\n 42\n]');
  });

  it('testIndentWithSpaces_failsWithNegativeValues', () => {
    expect(() => PrettyPrint.indentWithSpaces(-1)).toThrow(/negative/i);
  });

  it('testIndentWithSpaces_createsIndependentInstances', () => {
    const sw = new StringWriter();
    const config = PrettyPrint.indentWithSpaces(1);
    const w1 = config.createWriter(sw);
    const w2 = config.createWriter(sw);
    expect(w1).not.toBe(w2);
  });

  it('testIndentWithTabs', () => {
    new JsonArray().add(23).add(42).writeTo(output, PrettyPrint.indentWithTabs());
    expect(output.toString()).toBe('[\n\t23,\n\t42\n]');
  });

  it('testIndentWithTabs_createsIndependentInstances', () => {
    const sw = new StringWriter();
    const config = PrettyPrint.indentWithTabs();
    const w1 = config.createWriter(sw);
    const w2 = config.createWriter(sw);
    expect(w1).not.toBe(w2);
  });

  it('testSingleLine_nestedArray', () => {
    new JsonArray().add(23).add(new JsonArray().add(42)).writeTo(output, PrettyPrint.singleLine());
    expect(output.toString()).toBe('[23, [42]]');
  });

  it('testSingleLine_nestedObject', () => {
    new JsonObject()
      .add('a', 23)
      .add('b', new JsonObject().add('c', 42))
      .writeTo(output, PrettyPrint.singleLine());
    expect(output.toString()).toBe('{"a": 23, "b": {"c": 42}}');
  });

  it('testSingleLine_createsIndependentInstances', () => {
    const sw = new StringWriter();
    const config = PrettyPrint.singleLine();
    const w1 = config.createWriter(sw);
    const w2 = config.createWriter(sw);
    expect(w1).not.toBe(w2);
  });
});
