import { DefaultHandler, Json } from '@zenystx/helios-core/internal/json/Json';
import { JsonArray } from '@zenystx/helios-core/internal/json/JsonArray';
import { JsonHandler } from '@zenystx/helios-core/internal/json/JsonHandler';
import { JsonNumber } from '@zenystx/helios-core/internal/json/JsonNumber';
import { JsonObject } from '@zenystx/helios-core/internal/json/JsonObject';
import { JsonParser } from '@zenystx/helios-core/internal/json/JsonParser';
import { Location } from '@zenystx/helios-core/internal/json/Location';
import { ParseException } from '@zenystx/helios-core/internal/json/ParseException';
import { StringReader } from '@zenystx/helios-core/internal/json/StringReader';
import { beforeEach, describe, expect, it } from 'bun:test';

/** Records all parser events for assertion. */
class TestHandler extends JsonHandler<string, string> {
  lastLocation!: Location;
  private log = '';
  private sequence = 0;

  private record(event: string, ...args: unknown[]): void {
    this.lastLocation = this.getLocation();
    let line = event;
    for (const arg of args) {
      line += ' ' + String(arg);
    }
    line += ' ' + this.lastLocation.offset + '\n';
    this.log += line;
  }

  override startNull(): void { this.record('startNull'); }
  override endNull(): void { this.record('endNull'); }
  override startBoolean(): void { this.record('startBoolean'); }
  override endBoolean(value: boolean): void { this.record('endBoolean', value); }
  override startString(): void { this.record('startString'); }
  override endString(string: string): void { this.record('endString', string); }
  override startNumber(): void { this.record('startNumber'); }
  override endNumber(string: string): void { this.record('endNumber', string); }

  override startArray(): string {
    this.record('startArray');
    return 'a' + ++this.sequence;
  }
  override endArray(array: string): void { this.record('endArray', array); }
  override startArrayValue(array: string): void { this.record('startArrayValue', array); }
  override endArrayValue(array: string): void { this.record('endArrayValue', array); }

  override startObject(): string {
    this.record('startObject');
    return 'o' + ++this.sequence;
  }
  override endObject(object: string): void { this.record('endObject', object); }
  override startObjectName(object: string): void { this.record('startObjectName', object); }
  override endObjectName(object: string, name: string): void { this.record('endObjectName', object, name); }
  override startObjectValue(object: string, name: string): void { this.record('startObjectValue', object, name); }
  override endObjectValue(object: string, name: string): void { this.record('endObjectValue', object, name); }

  getLog(): string { return this.log; }
}

function join(...strings: string[]): string {
  return strings.map(s => s + '\n').join('');
}

describe('JsonParser_Test', () => {
  let handler: TestHandler;
  let parser: JsonParser;

  beforeEach(() => {
    handler = new TestHandler();
    parser = new JsonParser(handler);
  });

  /** Asserts that parsing the given json string throws a ParseException at the given offset with the given message prefix. */
  function assertParseException(offset: number, message: string, json: string): void {
    let ex: ParseException | null = null;
    try {
      parser.parse(json);
    } catch (e) {
      if (e instanceof ParseException) {
        ex = e;
      } else {
        throw e;
      }
    }
    expect(ex).not.toBeNull();
    expect(ex!.getLocation().offset).toBe(offset);
    expect(ex!.message.startsWith(message + ' at')).toBe(true);
  }

  it('constructor_rejectsNullHandler', () => {
    expect(() => new JsonParser(null as unknown as JsonHandler<unknown, unknown>)).toThrow();
  });

  it('parse_string_rejectsNull', () => {
    expect(() => parser.parse(null as unknown as string)).toThrow();
  });

  it('parse_reader_rejectsNull', () => {
    expect(() => parser.parse(null as unknown as StringReader)).toThrow();
  });

  it('parse_reader_rejectsNegativeBufferSize', () => {
    expect(() => parser.parse(new StringReader('[]'), -1)).toThrow();
  });

  it('parse_string_rejectsEmpty', () => {
    assertParseException(0, 'Unexpected end of input', '');
  });

  it('parse_reader_rejectsEmpty', () => {
    let ex: ParseException | null = null;
    try {
      parser.parse(new StringReader(''));
    } catch (e) {
      ex = e as ParseException;
    }
    expect(ex).not.toBeNull();
    expect(ex!.getLocation().offset).toBe(0);
    expect(ex!.message.startsWith('Unexpected end of input at')).toBe(true);
  });

  it('parse_null', () => {
    parser.parse('null');
    expect(handler.getLog()).toBe(join('startNull 0', 'endNull 4'));
  });

  it('parse_true', () => {
    parser.parse('true');
    expect(handler.getLog()).toBe(join('startBoolean 0', 'endBoolean true 4'));
  });

  it('parse_false', () => {
    parser.parse('false');
    expect(handler.getLog()).toBe(join('startBoolean 0', 'endBoolean false 5'));
  });

  it('parse_string', () => {
    parser.parse('"foo"');
    expect(handler.getLog()).toBe(join('startString 0', 'endString foo 5'));
  });

  it('parse_string_empty', () => {
    parser.parse('""');
    expect(handler.getLog()).toBe(join('startString 0', 'endString  2'));
  });

  it('parse_number', () => {
    parser.parse('23');
    expect(handler.getLog()).toBe(join('startNumber 0', 'endNumber 23 2'));
  });

  it('parse_number_negative', () => {
    parser.parse('-23');
    expect(handler.getLog()).toBe(join('startNumber 0', 'endNumber -23 3'));
  });

  it('parse_number_negative_exponent', () => {
    parser.parse('-2.3e-12');
    expect(handler.getLog()).toBe(join('startNumber 0', 'endNumber -2.3e-12 8'));
  });

  it('parse_array', () => {
    parser.parse('[23]');
    expect(handler.getLog()).toBe(join(
      'startArray 0',
      'startArrayValue a1 1',
      'startNumber 1',
      'endNumber 23 3',
      'endArrayValue a1 3',
      'endArray a1 4',
    ));
  });

  it('parse_array_empty', () => {
    parser.parse('[]');
    expect(handler.getLog()).toBe(join('startArray 0', 'endArray a1 2'));
  });

  it('parse_object', () => {
    parser.parse('{"foo": 23}');
    expect(handler.getLog()).toBe(join(
      'startObject 0',
      'startObjectName o1 1',
      'endObjectName o1 foo 6',
      'startObjectValue o1 foo 8',
      'startNumber 8',
      'endNumber 23 10',
      'endObjectValue o1 foo 10',
      'endObject o1 11',
    ));
  });

  it('parse_object_empty', () => {
    parser.parse('{}');
    expect(handler.getLog()).toBe(join('startObject 0', 'endObject o1 2'));
  });

  it('parse_stripsPadding', () => {
    expect(new JsonArray().equals(Json.parse(' [ ] '))).toBe(true);
  });

  it('parse_ignoresAllWhiteSpace', () => {
    expect(new JsonArray().equals(Json.parse('\t\r\n [\t\r\n ]\t\r\n '))).toBe(true);
  });

  it('parse_failsWithUnterminatedString', () => {
    assertParseException(5, 'Unexpected end of input', '["foo');
  });

  it('parse_lineAndColumn_onFirstLine', () => {
    parser.parse('[]');
    expect(handler.lastLocation.toString()).toBe('1:3');
  });

  it('parse_lineAndColumn_afterLF', () => {
    parser.parse('[\n]');
    expect(handler.lastLocation.toString()).toBe('2:2');
  });

  it('parse_lineAndColumn_afterCRLF', () => {
    parser.parse('[\r\n]');
    expect(handler.lastLocation.toString()).toBe('2:2');
  });

  it('parse_lineAndColumn_afterCR', () => {
    parser.parse('[\r]');
    expect(handler.lastLocation.toString()).toBe('1:4');
  });

  it('parse_handlesInputsThatExceedBufferSize', () => {
    const defHandler = new DefaultHandler();
    const p = new JsonParser(defHandler);
    const input = '[ 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47 ]';
    p.parse(new StringReader(input), 3);
    expect(defHandler.getValue().toString()).toBe('[2,3,5,7,11,13,17,19,23,29,31,37,41,43,47]');
  });

  it('parse_handlesStringsThatExceedBufferSize', () => {
    const defHandler = new DefaultHandler();
    const p = new JsonParser(defHandler);
    const input = '[ "lorem ipsum dolor sit amet" ]';
    p.parse(new StringReader(input), 3);
    expect(defHandler.getValue().toString()).toBe('["lorem ipsum dolor sit amet"]');
  });

  it('parse_handlesNumbersThatExceedBufferSize', () => {
    const defHandler = new DefaultHandler();
    const p = new JsonParser(defHandler);
    const input = '[ 3.141592653589 ]';
    p.parse(new StringReader(input), 3);
    expect(defHandler.getValue().toString()).toBe('[3.141592653589]');
  });

  it('parse_handlesPositionsCorrectlyWhenInputExceedsBufferSize', () => {
    const input = '{\n  "a": 23,\n  "b": 42,\n}';
    let ex: ParseException | null = null;
    try {
      parser.parse(new StringReader(input), 3);
    } catch (e) {
      ex = e as ParseException;
    }
    expect(ex).not.toBeNull();
    expect(ex!.getLocation().offset).toBe(24);
    expect(ex!.getLocation().line).toBe(4);
    expect(ex!.getLocation().column).toBe(1);
  });

  it('parse_failsOnTooDeeplyNestedArray', () => {
    let array = new JsonArray();
    for (let i = 0; i < 1001; i++) {
      array = new JsonArray().add(array);
    }
    const input = array.toString();
    let ex: ParseException | null = null;
    try {
      parser.parse(input);
    } catch (e) {
      ex = e as ParseException;
    }
    expect(ex).not.toBeNull();
    expect(ex!.message).toBe('Nesting too deep at 1:1002');
  });

  it('parse_failsOnTooDeeplyNestedObject', () => {
    let obj = new JsonObject();
    for (let i = 0; i < 1001; i++) {
      obj = new JsonObject().add('foo', obj);
    }
    const input = obj.toString();
    let ex: ParseException | null = null;
    try {
      parser.parse(input);
    } catch (e) {
      ex = e as ParseException;
    }
    expect(ex).not.toBeNull();
    expect(ex!.message).toBe('Nesting too deep at 1:7002');
  });

  it('parse_failsOnTooDeeplyNestedMixedObject', () => {
    let value: JsonArray | JsonObject = new JsonObject();
    for (let i = 0; i < 1001; i++) {
      if (i % 2 === 0) {
        value = new JsonArray().add(value);
      } else {
        value = new JsonObject().add('foo', value);
      }
    }
    const input = value.toString();
    let ex: ParseException | null = null;
    try {
      parser.parse(input);
    } catch (e) {
      ex = e as ParseException;
    }
    expect(ex).not.toBeNull();
    expect(ex!.message).toBe('Nesting too deep at 1:4002');
  });

  it('parse_doesNotFailWithManyArrays', () => {
    const array = new JsonArray();
    for (let i = 0; i < 1001; i++) {
      array.add(new JsonArray().add(7));
    }
    const result = Json.parse(array.toString());
    expect(result.isArray()).toBe(true);
  });

  it('parse_doesNotFailWithManyEmptyArrays', () => {
    const array = new JsonArray();
    for (let i = 0; i < 1001; i++) {
      array.add(new JsonArray());
    }
    const result = Json.parse(array.toString());
    expect(result.isArray()).toBe(true);
  });

  it('parse_doesNotFailWithManyObjects', () => {
    const array = new JsonArray();
    for (let i = 0; i < 1001; i++) {
      array.add(new JsonObject().add('a', 7));
    }
    const result = Json.parse(array.toString());
    expect(result.isArray()).toBe(true);
  });

  it('parse_doesNotFailWithManyEmptyObjects', () => {
    const array = new JsonArray();
    for (let i = 0; i < 1001; i++) {
      array.add(new JsonObject());
    }
    const result = Json.parse(array.toString());
    expect(result.isArray()).toBe(true);
  });

  it('parse_canBeCalledTwice', () => {
    parser.parse('[23]');
    parser.parse('[42]');
    expect(handler.getLog()).toBe(join(
      'startArray 0',
      'startArrayValue a1 1',
      'startNumber 1',
      'endNumber 23 3',
      'endArrayValue a1 3',
      'endArray a1 4',
      'startArray 0',
      'startArrayValue a2 1',
      'startNumber 1',
      'endNumber 42 3',
      'endArrayValue a2 3',
      'endArray a2 4',
    ));
  });

  it('arrays_empty', () => {
    expect(Json.parse('[]').toString()).toBe('[]');
  });

  it('arrays_singleValue', () => {
    expect(Json.parse('[23]').toString()).toBe('[23]');
  });

  it('arrays_multipleValues', () => {
    expect(Json.parse('[23,42]').toString()).toBe('[23,42]');
  });

  it('arrays_withWhitespaces', () => {
    expect(Json.parse('[ 23 , 42 ]').toString()).toBe('[23,42]');
  });

  it('arrays_nested', () => {
    expect(Json.parse('[[23]]').toString()).toBe('[[23]]');
    expect(Json.parse('[[[]]]').toString()).toBe('[[[]]]');
    expect(Json.parse('[[23],42]').toString()).toBe('[[23],42]');
    expect(Json.parse('[[23],[42]]').toString()).toBe('[[23],[42]]');
    expect(Json.parse('[{"foo":[23]},{"bar":[42]}]').toString()).toBe('[{"foo":[23]},{"bar":[42]}]');
  });

  it('arrays_illegalSyntax', () => {
    assertParseException(1, 'Expected value', '[,]');
    assertParseException(4, "Expected ',' or ']'", '[23 42]');
    assertParseException(4, 'Expected value', '[23,]');
  });

  it('arrays_incomplete', () => {
    assertParseException(1, 'Unexpected end of input', '[');
    assertParseException(2, 'Unexpected end of input', '[ ');
    assertParseException(3, 'Unexpected end of input', '[23');
    assertParseException(4, 'Unexpected end of input', '[23 ');
    assertParseException(4, 'Unexpected end of input', '[23,');
    assertParseException(5, 'Unexpected end of input', '[23, ');
  });

  it('objects_empty', () => {
    expect(Json.parse('{}').toString()).toBe('{}');
  });

  it('objects_singleValue', () => {
    expect(Json.parse('{"foo":23}').toString()).toBe('{"foo":23}');
  });

  it('objects_multipleValues', () => {
    expect(Json.parse('{"foo":23,"bar":42}').toString()).toBe('{"foo":23,"bar":42}');
  });

  it('objects_whitespace', () => {
    expect(Json.parse('{ "foo" : 23, "bar" : 42 }').toString()).toBe('{"foo":23,"bar":42}');
  });

  it('objects_nested', () => {
    expect(Json.parse('{"foo":{}}').toString()).toBe('{"foo":{}}');
    expect(Json.parse('{"foo":{"bar": 42}}').toString()).toBe('{"foo":{"bar":42}}');
    expect(Json.parse('{"foo":{"bar": {"baz": 42}}}').toString()).toBe('{"foo":{"bar":{"baz":42}}}');
    expect(Json.parse('{"foo":[{"bar": {"baz": [[42]]}}]}').toString()).toBe('{"foo":[{"bar":{"baz":[[42]]}}]}');
  });

  it('objects_illegalSyntax', () => {
    assertParseException(1, 'Expected name', '{,}');
    assertParseException(1, 'Expected name', '{:}');
    assertParseException(1, 'Expected name', '{23}');
    assertParseException(4, "Expected ':'", '{"a"}');
    assertParseException(5, "Expected ':'", '{"a" "b"}');
    assertParseException(5, 'Expected value', '{"a":}');
    assertParseException(8, 'Expected name', '{"a":23,}');
    assertParseException(8, 'Expected name', '{"a":23,42');
  });

  it('objects_incomplete', () => {
    assertParseException(1, 'Unexpected end of input', '{');
    assertParseException(2, 'Unexpected end of input', '{ ');
    assertParseException(2, 'Unexpected end of input', '{"');
    assertParseException(4, 'Unexpected end of input', '{"a"');
    assertParseException(5, 'Unexpected end of input', '{"a" ');
    assertParseException(5, 'Unexpected end of input', '{"a":');
    assertParseException(6, 'Unexpected end of input', '{"a": ');
    assertParseException(7, 'Unexpected end of input', '{"a":23');
    assertParseException(8, 'Unexpected end of input', '{"a":23 ');
    assertParseException(8, 'Unexpected end of input', '{"a":23,');
    assertParseException(9, 'Unexpected end of input', '{"a":23, ');
  });

  it('strings_emptyString_isAccepted', () => {
    expect(Json.parse('""').asString()).toBe('');
  });

  it('strings_asciiCharacters_areAccepted', () => {
    expect(Json.parse('" "').asString()).toBe(' ');
    expect(Json.parse('"a"').asString()).toBe('a');
    expect(Json.parse('"foo"').asString()).toBe('foo');
    expect(Json.parse('"A2-D2"').asString()).toBe('A2-D2');
    expect(Json.parse('"\u007f"').asString()).toBe('\u007f');
  });

  it('strings_nonAsciiCharacters_areAccepted', () => {
    expect(Json.parse('"Русский"').asString()).toBe('Русский');
    expect(Json.parse('"العربية"').asString()).toBe('العربية');
    expect(Json.parse('"日本語"').asString()).toBe('日本語');
  });

  it('strings_controlCharacters_areRejected', () => {
    assertParseException(3, 'Expected valid string character', '"--\n--"');
    assertParseException(3, 'Expected valid string character', '"--\r\n--"');
    assertParseException(3, 'Expected valid string character', '"--\t--"');
    assertParseException(3, 'Expected valid string character', '"--\u0000--"');
    assertParseException(3, 'Expected valid string character', '"--\u001f--"');
  });

  it('strings_validEscapes_areAccepted', () => {
    expect(Json.parse('" \\" "').asString()).toBe(' " ');
    expect(Json.parse('" \\\\ "').asString()).toBe(' \\ ');
    expect(Json.parse('" \\/ "').asString()).toBe(' / ');
    expect(Json.parse('" \\b "').asString()).toBe(' \u0008 ');
    expect(Json.parse('" \\f "').asString()).toBe(' \u000c ');
    expect(Json.parse('" \\r "').asString()).toBe(' \r ');
    expect(Json.parse('" \\n "').asString()).toBe(' \n ');
    expect(Json.parse('" \\t "').asString()).toBe(' \t ');
  });

  it('strings_escape_atStart', () => {
    expect(Json.parse('"\\\\x"').asString()).toBe('\\x');
  });

  it('strings_escape_atEnd', () => {
    expect(Json.parse('"x\\\\"').asString()).toBe('x\\');
  });

  it('strings_illegalEscapes_areRejected', () => {
    assertParseException(2, 'Expected valid escape sequence', '"\\a"');
    assertParseException(2, 'Expected valid escape sequence', '"\\x"');
    assertParseException(2, 'Expected valid escape sequence', '"\\000"');
  });

  it('strings_validUnicodeEscapes_areAccepted', () => {
    expect(Json.parse('"\\u0021"').asString()).toBe('\u0021');
    expect(Json.parse('"\\u4711"').asString()).toBe('\u4711');
    expect(Json.parse('"\\uffff"').asString()).toBe('\uffff');
    expect(Json.parse('"\\uabcdx"').asString()).toBe('\uabcdx');
  });

  it('strings_illegalUnicodeEscapes_areRejected', () => {
    assertParseException(3, 'Expected hexadecimal digit', '"\\u "');
    assertParseException(3, 'Expected hexadecimal digit', '"\\ux"');
    assertParseException(5, 'Expected hexadecimal digit', '"\\u20 "');
    assertParseException(6, 'Expected hexadecimal digit', '"\\u000x"');
  });

  it('strings_incompleteStrings_areRejected', () => {
    assertParseException(1, 'Unexpected end of input', '"');
    assertParseException(4, 'Unexpected end of input', '"foo');
    assertParseException(5, 'Unexpected end of input', '"foo\\');
    assertParseException(6, 'Unexpected end of input', '"foo\\n');
    assertParseException(6, 'Unexpected end of input', '"foo\\u');
    assertParseException(7, 'Unexpected end of input', '"foo\\u0');
    assertParseException(9, 'Unexpected end of input', '"foo\\u000');
    assertParseException(10, 'Unexpected end of input', '"foo\\u0000');
  });

  it('numbers_integer', () => {
    expect(new JsonNumber('0').equals(Json.parse('0'))).toBe(true);
    expect(new JsonNumber('-0').equals(Json.parse('-0'))).toBe(true);
    expect(new JsonNumber('1').equals(Json.parse('1'))).toBe(true);
    expect(new JsonNumber('-1').equals(Json.parse('-1'))).toBe(true);
    expect(new JsonNumber('23').equals(Json.parse('23'))).toBe(true);
    expect(new JsonNumber('-23').equals(Json.parse('-23'))).toBe(true);
    expect(new JsonNumber('1234567890').equals(Json.parse('1234567890'))).toBe(true);
    expect(new JsonNumber('123456789012345678901234567890').equals(
      Json.parse('123456789012345678901234567890'))).toBe(true);
  });

  it('numbers_minusZero', () => {
    const value = Json.parse('-0');
    expect(value.asInt()).toBe(0);
    expect(value.asLong()).toBe(0);
    expect(value.asFloat()).toBeCloseTo(0);
    expect(value.asDouble()).toBeCloseTo(0);
  });

  it('numbers_decimal', () => {
    expect(new JsonNumber('0.23').equals(Json.parse('0.23'))).toBe(true);
    expect(new JsonNumber('-0.23').equals(Json.parse('-0.23'))).toBe(true);
    expect(new JsonNumber('1234567890.12345678901234567890').equals(
      Json.parse('1234567890.12345678901234567890'))).toBe(true);
  });

  it('numbers_withExponent', () => {
    expect(new JsonNumber('0.1e9').equals(Json.parse('0.1e9'))).toBe(true);
    expect(new JsonNumber('0.1E9').equals(Json.parse('0.1E9'))).toBe(true);
    expect(new JsonNumber('-0.23e9').equals(Json.parse('-0.23e9'))).toBe(true);
    expect(new JsonNumber('0.23e9').equals(Json.parse('0.23e9'))).toBe(true);
    expect(new JsonNumber('0.23e+9').equals(Json.parse('0.23e+9'))).toBe(true);
    expect(new JsonNumber('0.23e-9').equals(Json.parse('0.23e-9'))).toBe(true);
  });

  it('numbers_withInvalidFormat', () => {
    assertParseException(0, 'Expected value', '+1');
    assertParseException(0, 'Expected value', '.1');
    assertParseException(1, 'Unexpected character', '02');
    assertParseException(2, 'Unexpected character', '-02');
    assertParseException(1, 'Expected digit', '-x');
    assertParseException(2, 'Expected digit', '1.x');
    assertParseException(2, 'Expected digit', '1ex');
    assertParseException(3, 'Unexpected character', '1e1x');
  });

  it('numbers_incomplete', () => {
    assertParseException(1, 'Unexpected end of input', '-');
    assertParseException(2, 'Unexpected end of input', '1.');
    assertParseException(4, 'Unexpected end of input', '1.0e');
    assertParseException(5, 'Unexpected end of input', '1.0e-');
  });

  it('null_complete', () => {
    expect(Json.NULL.equals(Json.parse('null'))).toBe(true);
  });

  it('null_incomplete', () => {
    assertParseException(1, 'Unexpected end of input', 'n');
    assertParseException(2, 'Unexpected end of input', 'nu');
    assertParseException(3, 'Unexpected end of input', 'nul');
  });

  it('null_withIllegalCharacter', () => {
    assertParseException(1, "Expected 'u'", 'nx');
    assertParseException(2, "Expected 'l'", 'nux');
    assertParseException(3, "Expected 'l'", 'nulx');
    assertParseException(4, 'Unexpected character', 'nullx');
  });

  it('true_complete', () => {
    expect(Json.parse('true')).toBe(Json.TRUE);
  });

  it('true_incomplete', () => {
    assertParseException(1, 'Unexpected end of input', 't');
    assertParseException(2, 'Unexpected end of input', 'tr');
    assertParseException(3, 'Unexpected end of input', 'tru');
  });

  it('true_withIllegalCharacter', () => {
    assertParseException(1, "Expected 'r'", 'tx');
    assertParseException(2, "Expected 'u'", 'trx');
    assertParseException(3, "Expected 'e'", 'trux');
    assertParseException(4, 'Unexpected character', 'truex');
  });

  it('false_complete', () => {
    expect(Json.parse('false')).toBe(Json.FALSE);
  });

  it('false_incomplete', () => {
    assertParseException(1, 'Unexpected end of input', 'f');
    assertParseException(2, 'Unexpected end of input', 'fa');
    assertParseException(3, 'Unexpected end of input', 'fal');
    assertParseException(4, 'Unexpected end of input', 'fals');
  });

  it('false_withIllegalCharacter', () => {
    assertParseException(1, "Expected 'a'", 'fx');
    assertParseException(2, "Expected 'l'", 'fax');
    assertParseException(3, "Expected 's'", 'falx');
    assertParseException(4, "Expected 'e'", 'falsx');
    assertParseException(5, 'Unexpected character', 'falsex');
  });
});
