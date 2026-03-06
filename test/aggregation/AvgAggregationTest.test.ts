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
  sampleValueContainers,
  addValues,
} from './helpers/TestSamples';
import {
  sumBigDecimals,
  sumBigIntegers,
  sumDoubles,
  sumFloatingPointNumbers,
  sumIntegers,
  sumLongs,
  sumValueContainer,
} from './helpers/Sums';
import { ValueType } from './helpers/ValueContainer';

const ERROR = 1e-8;

describe('AvgAggregationTest', () => {
  test('testBigDecimalAvg', () => {
    const values = sampleBigDecimals();
    const expectation = sumBigDecimals(values) / values.length;

    const aggregation = Aggregators.bigDecimalAvg();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.bigDecimalAvg();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testBigDecimalAvg_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.BIG_DECIMAL);
    const expectation = sumValueContainer(values, ValueType.BIG_DECIMAL) / values.length;

    const aggregation = Aggregators.bigDecimalAvg('bigDecimal');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.bigDecimalAvg('bigDecimal');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testBigDecimalAvg_withNull', () => {
    const aggregation = Aggregators.bigDecimalAvg();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testBigDecimalAvg_withAttributePath_withNull', () => {
    const aggregation = Aggregators.bigDecimalAvg('bigDecimal');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testBigIntegerAvg', () => {
    const values = sampleBigIntegers();
    const expectation = sumBigIntegers(values) / values.length;

    const aggregation = Aggregators.bigIntegerAvg();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.bigIntegerAvg();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testBigIntegerAvg_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.BIG_INTEGER);
    const expectation = sumValueContainer(values, ValueType.BIG_INTEGER) / values.length;

    const aggregation = Aggregators.bigIntegerAvg('bigInteger');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.bigIntegerAvg('bigInteger');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testBigIntegerAvg_withNull', () => {
    const aggregation = Aggregators.bigIntegerAvg();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testBigIntegerAvg_withAttributePath_withNull', () => {
    const aggregation = Aggregators.bigIntegerAvg('bigDecimal');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testDoubleAvg', () => {
    const values = sampleDoubles();
    const expectation = sumDoubles(values) / values.length;

    const aggregation = Aggregators.doubleAvg();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.doubleAvg();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testDoubleAvg_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.DOUBLE);
    const expectation = sumValueContainer(values, ValueType.DOUBLE) / values.length;

    const aggregation = Aggregators.doubleAvg('doubleValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.doubleAvg('doubleValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testDoubleAvg_withNull', () => {
    const aggregation = Aggregators.doubleAvg();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testDoubleAvg_withAttributePath_withNull', () => {
    const aggregation = Aggregators.doubleAvg('bigDecimal');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testIntegerAvg', () => {
    const values = sampleIntegers();
    const expectation = sumIntegers(values) / values.length;

    const aggregation = Aggregators.integerAvg();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.integerAvg();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testIntegerAvg_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.INTEGER);
    const expectation = sumValueContainer(values, ValueType.INTEGER) / values.length;

    const aggregation = Aggregators.integerAvg('intValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.integerAvg('intValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testIntegerAvg_withNull', () => {
    const aggregation = Aggregators.integerAvg();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testIntegerAvg_withAttributePath_withNull', () => {
    const aggregation = Aggregators.integerAvg('bigDecimal');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testLongAvg', () => {
    const values = sampleLongs();
    const expectation = sumLongs(values) / values.length;

    const aggregation = Aggregators.longAvg();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.longAvg();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testLongAvg_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.LONG);
    const expectation = sumValueContainer(values, ValueType.LONG) / values.length;

    const aggregation = Aggregators.longAvg('longValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.longAvg('longValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testLongAvg_withNull', () => {
    const aggregation = Aggregators.longAvg();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testLongAvg_withAttributePath_withNull', () => {
    const aggregation = Aggregators.longAvg('bigDecimal');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testGenericAvg', () => {
    const values = [...sampleLongs(), ...sampleDoubles(), ...sampleIntegers()];
    const expectation = sumFloatingPointNumbers(values) / values.length;

    const aggregation = Aggregators.numberAvg();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.numberAvg();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testGenericAvg_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.NUMBER);
    addValues(values, ValueType.DOUBLE);
    const expectation = sumValueContainer(values, ValueType.NUMBER) / values.length;

    const aggregation = Aggregators.numberAvg('numberValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.numberAvg('numberValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testGenericAvg_withNull', () => {
    const aggregation = Aggregators.numberAvg();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testGenericAvg_withAttributePath_withNull', () => {
    const aggregation = Aggregators.numberAvg('bigDecimal');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });
});
