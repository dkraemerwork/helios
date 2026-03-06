import { describe, test, expect } from 'bun:test';
import { Aggregators } from '@zenystx/helios-core/aggregation/Aggregators';
import {
  createEntryWithValue,
  createExtractableEntryWithValue,
  sampleBigDecimals,
  sampleBigIntegers,
  sampleDoubles,
  sampleFloats,
  sampleIntegers,
  sampleLongs,
  sampleValueContainers,
  addValues,
} from './helpers/TestSamples';
import {
  sumBigDecimals,
  sumBigIntegers,
  sumDoubles,
  sumFixedPointNumbers,
  sumFloatingPointNumbers,
  sumIntegers,
  sumLongs,
  sumValueContainer,
} from './helpers/Sums';
import { ValueType } from './helpers/ValueContainer';

const ERROR = 1e-8;

describe('SumAggregationTest', () => {
  test('testBigDecimalSum', () => {
    const values = sampleBigDecimals();
    const expectation = sumBigDecimals(values);

    const aggregation = Aggregators.bigDecimalSum();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.bigDecimalSum();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testBigDecimalSum_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.BIG_DECIMAL);
    const expectation = sumValueContainer(values, ValueType.BIG_DECIMAL);

    const aggregation = Aggregators.bigDecimalSum('bigDecimal');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.bigDecimalSum('bigDecimal');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testBigDecimalSum_withNull', () => {
    const aggregation = Aggregators.bigDecimalSum();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testBigDecimalSum_withAttributePath_withNull', () => {
    const aggregation = Aggregators.bigDecimalSum('numberValue');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testBigIntegerSum', () => {
    const values = sampleBigIntegers();
    const expectation = sumBigIntegers(values);

    const aggregation = Aggregators.bigIntegerSum();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.bigIntegerSum();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testBigIntegerSum_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.BIG_INTEGER);
    const expectation = sumValueContainer(values, ValueType.BIG_INTEGER);

    const aggregation = Aggregators.bigIntegerSum('bigInteger');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.bigIntegerSum('bigInteger');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testBigIntegerSum_withNull', () => {
    const aggregation = Aggregators.bigIntegerSum();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testBigIntegerSum_withAttributePath_withNull', () => {
    const aggregation = Aggregators.bigIntegerSum('numberValue');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testDoubleSum', () => {
    const values = sampleDoubles();
    const expectation = sumDoubles(values);

    const aggregation = Aggregators.doubleSum();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.doubleSum();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testDoubleSum_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.DOUBLE);
    const expectation = sumValueContainer(values, ValueType.DOUBLE);

    const aggregation = Aggregators.doubleSum('doubleValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.doubleSum('doubleValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testDoubleSum_withNull', () => {
    const aggregation = Aggregators.doubleSum();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testDoubleSum_withAttributePath_withNull', () => {
    const aggregation = Aggregators.doubleSum('numberValue');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testIntegerSum', () => {
    const values = sampleIntegers();
    const expectation = sumIntegers(values);

    const aggregation = Aggregators.integerSum();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.integerSum();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testIntegerSum_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.INTEGER);
    const expectation = sumValueContainer(values, ValueType.INTEGER);

    const aggregation = Aggregators.integerSum('intValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.integerSum('intValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testIntegerSum_withNull', () => {
    const aggregation = Aggregators.integerSum();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testIntegerSum_withAttributePath_withNull', () => {
    const aggregation = Aggregators.integerSum('numberValue');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testLongSum', () => {
    const values = sampleLongs();
    const expectation = sumLongs(values);

    const aggregation = Aggregators.longSum();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.longSum();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testLongSum_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.LONG);
    const expectation = sumValueContainer(values, ValueType.LONG);

    const aggregation = Aggregators.longSum('longValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.longSum('longValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testLongSum_withNull', () => {
    const aggregation = Aggregators.longSum();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testLongSum_withAttributePath_withNull', () => {
    const aggregation = Aggregators.longSum('numberValue');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testFixedPointSum', () => {
    const values = [...sampleLongs(), ...sampleIntegers(), ...sampleBigIntegers()];
    const expectation = sumFixedPointNumbers(values);

    const aggregation = Aggregators.fixedPointSum();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.fixedPointSum();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBe(expectation);
  });

  test('testFixedPointSum_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.NUMBER);
    addValues(values, ValueType.BIG_INTEGER);
    const expectation = sumValueContainer(values, ValueType.NUMBER);

    const aggregation = Aggregators.fixedPointSum('numberValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.fixedPointSum('numberValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testFixedPointSum_withNull', () => {
    const aggregation = Aggregators.fixedPointSum();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testFixedPointSum_withAttributePath_withNull', () => {
    const aggregation = Aggregators.fixedPointSum('numberValue');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });

  test('testFloatingPointSum', () => {
    const values = [...sampleDoubles(), ...sampleFloats(), ...sampleBigDecimals()];
    const expectation = sumFloatingPointNumbers(values);

    const aggregation = Aggregators.floatingPointSum();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.floatingPointSum();
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testFloatingPointSum_withAttributePath', () => {
    const values = sampleValueContainers(ValueType.NUMBER);
    addValues(values, ValueType.DOUBLE);
    const expectation = sumValueContainer(values, ValueType.NUMBER);

    const aggregation = Aggregators.floatingPointSum('numberValue');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.floatingPointSum('numberValue');
    result2.combine(aggregation);
    expect(result2.aggregate()).toBeCloseTo(expectation, 8);
  });

  test('testFloatingPointSum_withNull', () => {
    const aggregation = Aggregators.floatingPointSum();
    expect(() => aggregation.accumulate(createEntryWithValue(null as unknown as number))).toThrow();
  });

  test('testFloatingPointSum_withAttributePath_withNull', () => {
    const aggregation = Aggregators.floatingPointSum('numberValue');
    expect(() => aggregation.accumulate(createExtractableEntryWithValue(null))).toThrow();
  });
});
