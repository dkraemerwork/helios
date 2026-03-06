import { describe, test, expect } from 'bun:test';
import { Aggregators } from '@zenystx/core/aggregation/Aggregators';
import {
  createEntryWithValue,
  createExtractableEntryWithValue,
  sampleBigDecimals,
  sampleBigIntegers,
  sampleDoubles,
  sampleIntegers,
  sampleLongs,
  sampleStrings,
  sampleValueContainers,
} from './helpers/TestSamples';
import { ValueType } from './helpers/ValueContainer';

describe('MaxAggregationTest', () => {
  test('testBigDecimalMax', () => {
    const values = sampleBigDecimals();
    values.sort((a, b) => a - b);
    const expectation = values[values.length - 1];

    const aggregation = Aggregators.bigDecimalMax();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.bigDecimalMax();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testBigDecimalMax_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.BIG_DECIMAL);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[values.length - 1]!.bigDecimal;

    const aggregation = Aggregators.bigDecimalMax('bigDecimal');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.bigDecimalMax('bigDecimal');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testBigIntegerMax', () => {
    const values = sampleBigIntegers();
    values.sort((a, b) => a - b);
    const expectation = values[values.length - 1];

    const aggregation = Aggregators.bigIntegerMax();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.bigIntegerMax();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testBigIntegerMax_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.BIG_INTEGER);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[values.length - 1]!.bigInteger;

    const aggregation = Aggregators.bigIntegerMax('bigInteger');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.bigIntegerMax('bigInteger');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testDoubleMax', () => {
    const values = sampleDoubles();
    values.sort((a, b) => a - b);
    const expectation = values[values.length - 1];

    const aggregation = Aggregators.doubleMax();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.doubleMax();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation!, 8);
  });

  test('testDoubleMax_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.DOUBLE);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[values.length - 1]!.doubleValue;

    const aggregation = Aggregators.doubleMax('doubleValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.doubleMax('doubleValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testIntegerMax', () => {
    const values = sampleIntegers();
    values.sort((a, b) => a - b);
    const expectation = values[values.length - 1];

    const aggregation = Aggregators.integerMax();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.integerMax();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testIntegerMax_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.INTEGER);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[values.length - 1]!.intValue;

    const aggregation = Aggregators.integerMax('intValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.integerMax('intValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testLongMax', () => {
    const values = sampleLongs();
    values.sort((a, b) => a - b);
    const expectation = values[values.length - 1];

    const aggregation = Aggregators.longMax();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.longMax();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testLongMax_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.LONG);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[values.length - 1]!.longValue;

    const aggregation = Aggregators.longMax('longValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.longMax('longValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testComparableMax', () => {
    const values = sampleStrings();
    values.sort();
    const expectation = values[values.length - 1];

    const aggregation = Aggregators.comparableMax<unknown, string>();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.comparableMax<unknown, string>();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testComparableMax_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.STRING);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[values.length - 1]!.stringValue;

    const aggregation = Aggregators.comparableMax<unknown, string>('stringValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.comparableMax<unknown, string>('stringValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testComparableMax_withNull', () => {
    const values = sampleStrings();
    values.sort();
    const expectation = values[values.length - 1];
    (values as Array<string | null>).push(null);

    const aggregation = Aggregators.comparableMax<unknown, string>();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.comparableMax<unknown, string>();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testComparableMax_withAttributePath_withNull', () => {
    const values = sampleValueContainers(ValueType.STRING);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[values.length - 1]!.stringValue;
    (values as Array<typeof values[0] | null>).push(null);

    const aggregation = Aggregators.comparableMax<unknown, string>('stringValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.comparableMax<unknown, string>('stringValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testMaxBy_withAttributePath_withNull', () => {
    const values = sampleValueContainers(ValueType.STRING);
    values.sort((a, b) => a.compareTo(b));
    const expectation = createExtractableEntryWithValue(values[values.length - 1]);
    (values as Array<typeof values[0] | null>).push(null);

    const aggregation = Aggregators.maxBy<ReturnType<typeof createExtractableEntryWithValue>>('stringValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.maxBy<ReturnType<typeof createExtractableEntryWithValue>>('stringValue');
    result2.combine(aggregation);
    const result = result2.aggregate();

    expect(result?.getKey()).toEqual(expectation.getKey());
    expect(result?.getValue()).toEqual(expectation.getValue());
  });
});
