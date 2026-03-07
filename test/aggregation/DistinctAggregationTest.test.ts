import { Aggregators } from '@zenystx/helios-core/aggregation/Aggregators';
import { describe, expect, test } from 'bun:test';
import { Person } from './helpers/Person';
import {
  createEntryWithValue,
  createExtractableEntryWithValue,
  sampleStrings,
} from './helpers/TestSamples';

function repeatTimes<T>(times: number, values: T[]): T[] {
  const result: T[] = [];
  for (let i = 0; i < times; i++) result.push(...values);
  return result;
}

describe('DistinctAggregationTest', () => {
  test('testCountAggregator', () => {
    const values = repeatTimes(3, sampleStrings());
    const expectation = new Set(values);

    const aggregation = Aggregators.distinct<unknown, string>();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.distinct<unknown, string>();
    result2.combine(aggregation);
    const result = result2.aggregate();

    expect(result).toEqual(expectation);
  });

  test('testCountAggregator_withNull', () => {
    const values: Array<string | null> = repeatTimes(3, sampleStrings());
    values.push(null);
    values.push(null);
    const expectation = new Set(values);

    const aggregation = Aggregators.distinct<unknown, string | null>();
    for (const v of values) aggregation.accumulate(createEntryWithValue(v));

    const result2 = Aggregators.distinct<unknown, string | null>();
    result2.combine(aggregation);
    const result = result2.aggregate();

    expect(result).toEqual(expectation);
  });

  test('testCountAggregator_withAttributePath', () => {
    const people = [new Person(5.1), new Person(3.3)];
    const ages = [5.1, 3.3];
    const values = repeatTimes(3, people);
    const expectation = new Set(ages);

    const aggregation = Aggregators.distinct<unknown, number>('age');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.distinct<unknown, number>('age');
    result2.combine(aggregation);
    const result = result2.aggregate();

    expect(result).toEqual(expectation);
  });

  test('testCountAggregator_withAttributePath_withNull', () => {
    const people: Array<Person | null> = [new Person(5.1), new Person(null)];
    const ages: Array<number | null> = [5.1, null];
    const values = repeatTimes(3, people);
    const expectation = new Set(ages);

    const aggregation = Aggregators.distinct<unknown, number | null>('age');
    for (const v of values) aggregation.accumulate(createExtractableEntryWithValue(v));

    const result2 = Aggregators.distinct<unknown, number | null>('age');
    result2.combine(aggregation);
    const result = result2.aggregate();

    expect(result).toEqual(expectation);
  });
});
