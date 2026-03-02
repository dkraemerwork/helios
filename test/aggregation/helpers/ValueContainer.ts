/** Port of com.hazelcast.aggregation.ValueContainer */
export const enum ValueType {
  INTEGER = 'INTEGER',
  LONG = 'LONG',
  FLOAT = 'FLOAT',
  DOUBLE = 'DOUBLE',
  BIG_DECIMAL = 'BIG_DECIMAL',
  BIG_INTEGER = 'BIG_INTEGER',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
}

export class ValueContainer {
  valueType: ValueType;
  intValue: number = 0;
  longValue: number = 0;
  floatValue: number = 0;
  doubleValue: number = 0;
  bigDecimal: number = 0;
  bigInteger: number = 0;
  numberValue: number = 0;
  stringValue: string = '';

  constructor();
  constructor(intValue: number);
  constructor(value: number, type: ValueType);
  constructor(value: string);
  constructor(value?: number | string, type?: ValueType) {
    if (value === undefined) {
      this.valueType = ValueType.NUMBER;
    } else if (typeof value === 'string') {
      this.valueType = ValueType.STRING;
      this.stringValue = value;
    } else if (type !== undefined) {
      this.valueType = type;
      switch (type) {
        case ValueType.INTEGER:
          this.intValue = value;
          break;
        case ValueType.LONG:
          this.longValue = value;
          break;
        case ValueType.FLOAT:
          this.floatValue = value;
          break;
        case ValueType.DOUBLE:
          this.doubleValue = value;
          break;
        case ValueType.BIG_DECIMAL:
          this.bigDecimal = value;
          break;
        case ValueType.BIG_INTEGER:
          this.bigInteger = value;
          break;
        case ValueType.NUMBER:
          this.numberValue = value;
          break;
      }
    } else {
      // Default: treat as integer
      this.valueType = ValueType.INTEGER;
      this.intValue = value;
    }
  }

  compareTo(other: ValueContainer): number {
    switch (this.valueType) {
      case ValueType.INTEGER:
        return this.intValue - other.intValue;
      case ValueType.LONG:
        return this.longValue - other.longValue;
      case ValueType.FLOAT:
        return this.floatValue < other.floatValue ? -1 : this.floatValue > other.floatValue ? 1 : 0;
      case ValueType.DOUBLE:
        return this.doubleValue < other.doubleValue ? -1 : this.doubleValue > other.doubleValue ? 1 : 0;
      case ValueType.BIG_DECIMAL:
        return this.bigDecimal < other.bigDecimal ? -1 : this.bigDecimal > other.bigDecimal ? 1 : 0;
      case ValueType.BIG_INTEGER:
        return this.bigInteger - other.bigInteger;
      case ValueType.STRING:
        return this.stringValue < other.stringValue ? -1 : this.stringValue > other.stringValue ? 1 : 0;
      default:
        return 0;
    }
  }
}

export function makeIntContainer(v: number): ValueContainer {
  const c = new ValueContainer();
  c.valueType = ValueType.INTEGER;
  c.intValue = v;
  return c;
}

export function makeLongContainer(v: number): ValueContainer {
  const c = new ValueContainer();
  c.valueType = ValueType.LONG;
  c.longValue = v;
  return c;
}

export function makeDoubleContainer(v: number): ValueContainer {
  const c = new ValueContainer();
  c.valueType = ValueType.DOUBLE;
  c.doubleValue = v;
  return c;
}

export function makeBigDecimalContainer(v: number): ValueContainer {
  const c = new ValueContainer();
  c.valueType = ValueType.BIG_DECIMAL;
  c.bigDecimal = v;
  return c;
}

export function makeBigIntegerContainer(v: number): ValueContainer {
  const c = new ValueContainer();
  c.valueType = ValueType.BIG_INTEGER;
  c.bigInteger = v;
  return c;
}

export function makeNumberContainer(v: number): ValueContainer {
  const c = new ValueContainer();
  c.valueType = ValueType.NUMBER;
  c.numberValue = v;
  return c;
}

export function makeStringContainer(v: string): ValueContainer {
  const c = new ValueContainer();
  c.valueType = ValueType.STRING;
  c.stringValue = v;
  return c;
}
