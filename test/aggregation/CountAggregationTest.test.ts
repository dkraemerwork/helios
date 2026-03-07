import { Aggregators } from '@zenystx/helios-core/aggregation/Aggregators';
import { describe, expect, test } from 'bun:test';
import {
  createEntryWithValue,
  createExtractableEntryWithValue,
  sampleBigDecimals,
  samplePersons,
} from './helpers/TestSamples';

describe('CountAggregationTest', () => {
  test('testCountAggregator', () => {
    const values = sampleBigDecimals();
    const expectation = values.length;

    const aggregation = Aggregators.count();
    for (const value of values) {
      aggregation.accumulate(createEntryWithValue(value));
    }

    const resultAggregation = Aggregators.count();
    resultAggregation.combine(aggregation);
    const result = resultAggregation.aggregate();

    expect(result).toBe(expectation);
  });

  test('testCountAggregator_withAttributePath', () => {
    const values = samplePersons();
    const expectation = values.length;

    const aggregation = Aggregators.count('age');
    for (const person of values) {
      aggregation.accumulate(createExtractableEntryWithValue(person));
    }

    const resultAggregation = Aggregators.count('age');
    resultAggregation.combine(aggregation);
    const result = resultAggregation.aggregate();

    expect(result).toBe(expectation);
  });

  test('testCountAggregator_withNull', () => {
    const values = sampleBigDecimals();
    values.push(null as unknown as number);
    const expectation = values.length;

    const aggregation = Aggregators.count();
    for (const value of values) {
      aggregation.accumulate(createEntryWithValue(value));
    }

    const resultAggregation = Aggregators.count();
    resultAggregation.combine(aggregation);
    const result = resultAggregation.aggregate();

    expect(result).toBe(expectation);
  });

  test('testCountAggregator_withAttributePath_withNull', () => {
    const values = samplePersons();
    values.push(null as unknown as ReturnType<typeof samplePersons>[number]);
    const expectation = values.length;

    const aggregation = Aggregators.count('age');
    for (const person of values) {
      aggregation.accumulate(createExtractableEntryWithValue(person));
    }

    const resultAggregation = Aggregators.count('age');
    resultAggregation.combine(aggregation);
    const result = resultAggregation.aggregate();

    expect(result).toBe(expectation);
  });
});
