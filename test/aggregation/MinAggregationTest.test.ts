import { describe, test, expect } from 'bun:test';
import { Aggregators } from '@zenystx/helios-core/aggregation/Aggregators';
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

describe('MinAggregationTest', () => {
  test('testBigDecimalMin', () => {
    const values = sampleBigDecimals();
    values.sort((a, b) => a - b);
    const expectation = values[0];

    const aggregation = Aggregators.bigDecimalMin();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.bigDecimalMin();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testBigDecimalMin_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.BIG_DECIMAL);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[0]!.bigDecimal;

    const aggregation = Aggregators.bigDecimalMin('bigDecimal');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.bigDecimalMin('bigDecimal');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testBigIntegerMin', () => {
    const values = sampleBigIntegers();
    values.sort((a, b) => a - b);
    const expectation = values[0];

    const aggregation = Aggregators.bigIntegerMin();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.bigIntegerMin();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testBigIntegerMin_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.BIG_INTEGER);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[0]!.bigInteger;

    const aggregation = Aggregators.bigIntegerMin('bigInteger');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.bigIntegerMin('bigInteger');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testDoubleMin', () => {
    const values = sampleDoubles();
    values.sort((a, b) => a - b);
    const expectation = values[0];

    const aggregation = Aggregators.doubleMin();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.doubleMin();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation!, 8);
  });

  test('testDoubleMin_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.DOUBLE);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[0]!.doubleValue;

    const aggregation = Aggregators.doubleMin('doubleValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.doubleMin('doubleValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testIntegerMin', () => {
    const values = sampleIntegers();
    values.sort((a, b) => a - b);
    const expectation = values[0];

    const aggregation = Aggregators.integerMin();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.integerMin();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testIntegerMin_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.INTEGER);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[0]!.intValue;

    const aggregation = Aggregators.integerMin('intValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.integerMin('intValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testLongMin', () => {
    const values = sampleLongs();
    values.sort((a, b) => a - b);
    const expectation = values[0];

    const aggregation = Aggregators.longMin();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.longMin();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testLongMin_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.LONG);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[0]!.longValue;

    const aggregation = Aggregators.longMin('longValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.longMin('longValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testComparableMin', () => {
    const values = sampleStrings();
    values.sort();
    const expectation = values[0];

    const aggregation = Aggregators.comparableMin<unknown, string>();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.comparableMin<unknown, string>();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testComparableMin_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.STRING);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[0]!.stringValue;

    const aggregation = Aggregators.comparableMin<unknown, string>('stringValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.comparableMin<unknown, string>('stringValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testComparableMin_withNull', () => {
    const values = sampleStrings();
    values.sort();
    const expectation = values[0];
    (values as Array<string | null>).push(null);

    const aggregation = Aggregators.comparableMin<unknown, string>();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.comparableMin<unknown, string>();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testComparableMin_withAttributePath_withNull', () => {
    const values = sampleValueContainers(ValueType.STRING);
    values.sort((a, b) => a.compareTo(b));
    const expectation = values[0]!.stringValue;
    (values as Array<typeof values[0] | null>).push(null);

    const aggregation = Aggregators.comparableMin<unknown, string>('stringValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.comparableMin<unknown, string>('stringValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testMinBy_withAttributePath_withNull', () => {
    const values = sampleValueContainers(ValueType.STRING);
    values.sort((a, b) => a.compareTo(b));
    const expectation = createExtractableEntryWithValue(values[0]);
    (values as Array<typeof values[0] | null>).push(null);

    const aggregation = Aggregators.minBy<ReturnType<typeof createExtractableEntryWithValue>>('stringValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.minBy<ReturnType<typeof createExtractableEntryWithValue>>('stringValue');
    result2.combine(aggregation);
    const result = result2.aggregate();

    // result and expectation both wrap the same ValueContainer object
    expect(result?.getKey()).toEqual(expectation.getKey());
    expect(result?.getValue()).toEqual(expectation.getValue());
  });
});
