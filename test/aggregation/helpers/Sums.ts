import { ValueContainer, ValueType } from './ValueContainer';

/** Port of com.hazelcast.aggregation.Sums */

export function sumIntegers(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

export function sumLongs(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

export function sumDoubles(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

/** BigDecimal → number */
export function sumBigDecimals(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

/** BigInteger → number */
export function sumBigIntegers(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

export function sumFloatingPointNumbers(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

export function sumFixedPointNumbers(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += Math.trunc(v);
  return sum;
}

export function sumValueContainer(
  containers: ValueContainer[],
  valueType: ValueType,
): number {
  switch (valueType) {
    case ValueType.INTEGER: {
      let s = 0;
      for (const c of containers) s += c.intValue;
      return s;
    }
    case ValueType.LONG: {
      let s = 0;
      for (const c of containers) s += c.longValue;
      return s;
    }
    case ValueType.DOUBLE: {
      let s = 0;
      for (const c of containers) s += c.doubleValue;
      return s;
    }
    case ValueType.BIG_DECIMAL: {
      let s = 0;
      for (const c of containers) s += c.bigDecimal;
      return s;
    }
    case ValueType.BIG_INTEGER: {
      let s = 0;
      for (const c of containers) s += c.bigInteger;
      return s;
    }
    case ValueType.NUMBER: {
      let s = 0;
      for (const c of containers) s += c.numberValue;
      return s;
    }
    default:
      return 0;
  }
}
