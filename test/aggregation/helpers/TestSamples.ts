import {
  ValueContainer,
  ValueType,
  makeIntContainer,
  makeLongContainer,
  makeDoubleContainer,
  makeBigDecimalContainer,
  makeBigIntegerContainer,
  makeNumberContainer,
  makeStringContainer,
} from './ValueContainer';
import { Person } from './Person';

/** Port of com.hazelcast.aggregation.TestSamples */

const NUMBER_OF_SAMPLE_VALUES = 10000;
const LOREM_IPSUM = 'Lorem ipsum dolor sit amet consectetur adipiscing elit';

/** Simple Map.Entry with same key and value */
export interface MapEntry<K, V> {
  getKey(): K;
  getValue(): V;
}

/** Extractable map entry that supports attribute path extraction via property access */
export class ExtractableEntry<K, V> implements MapEntry<K, V> {
  constructor(
    private readonly key: K,
    private readonly value: V,
  ) {}

  getKey(): K {
    return this.key;
  }

  getValue(): V {
    return this.value;
  }

  getAttributeValue(path: string): unknown {
    if (this.value == null) return null;
    return (this.value as Record<string, unknown>)[path];
  }
}

class SimpleEntry<K, V> implements MapEntry<K, V> {
  constructor(
    private readonly key: K,
    private readonly value: V,
  ) {}

  getKey(): K {
    return this.key;
  }

  getValue(): V {
    return this.value;
  }
}

export function createEntryWithValue<T>(value: T): MapEntry<T, T> {
  return new SimpleEntry(value, value);
}

/** ss parameter is ignored – TypeScript uses direct property access */
export function createExtractableEntryWithValue<T>(value: T, ss?: unknown): ExtractableEntry<T, T> {
  return new ExtractableEntry(value, value);
}

function randomDouble(): number {
  return Math.random() + 0.01;
}

function randomInt(from: number, to: number): number {
  return from + Math.floor(Math.random() * to);
}

function sampleRaw(): number[] {
  const values: number[] = [];
  for (let i = 0; i < NUMBER_OF_SAMPLE_VALUES; i++) {
    values.push(randomInt(1, 1000) * randomDouble());
  }
  return values;
}

export function sampleIntegers(): number[] {
  return sampleRaw().map(v => Math.trunc(v));
}

export function sampleLongs(): number[] {
  return sampleRaw().map(v => Math.trunc(v));
}

export function sampleFloats(): number[] {
  return sampleRaw();
}

export function sampleDoubles(): number[] {
  return sampleRaw();
}

/** BigDecimal → number */
export function sampleBigDecimals(): number[] {
  return sampleRaw();
}

/** BigInteger → number (integer) */
export function sampleBigIntegers(): number[] {
  return sampleRaw().map(v => Math.trunc(v));
}

export function sampleStrings(): string[] {
  return LOREM_IPSUM.split(' ');
}

export function samplePersons(): Person[] {
  return sampleDoubles().map(age => new Person(age));
}

export function sampleValueContainers(valueType: ValueType): ValueContainer[] {
  switch (valueType) {
    case ValueType.INTEGER:
      return sampleIntegers().map(makeIntContainer);
    case ValueType.LONG:
      return sampleLongs().map(makeLongContainer);
    case ValueType.DOUBLE:
      return sampleDoubles().map(makeDoubleContainer);
    case ValueType.BIG_DECIMAL:
      return sampleBigDecimals().map(makeBigDecimalContainer);
    case ValueType.BIG_INTEGER:
      return sampleBigIntegers().map(makeBigIntegerContainer);
    case ValueType.NUMBER: {
      const containers: ValueContainer[] = [];
      for (const v of sampleLongs()) containers.push(makeNumberContainer(v));
      for (const v of sampleIntegers()) containers.push(makeNumberContainer(v));
      return containers;
    }
    case ValueType.STRING:
      return sampleStrings().map(makeStringContainer);
    default:
      return [];
  }
}

export function addValues(containers: ValueContainer[], valueType: ValueType): void {
  switch (valueType) {
    case ValueType.DOUBLE:
      for (const v of sampleDoubles()) containers.push(makeNumberContainer(v));
      break;
    case ValueType.BIG_INTEGER:
      for (const v of sampleBigIntegers()) containers.push(makeNumberContainer(v));
      break;
  }
}
