import type { Aggregator } from './Aggregator';
import { CountAggregator } from './impl/CountAggregator';
import { DistinctValuesAggregator } from './impl/DistinctValuesAggregator';
import { MinAggregator } from './impl/MinAggregator';
import { MaxAggregator } from './impl/MaxAggregator';
import { MinByAggregator } from './impl/MinByAggregator';
import { MaxByAggregator } from './impl/MaxByAggregator';
import { DoubleSumAggregator } from './impl/DoubleSumAggregator';
import { LongSumAggregator } from './impl/LongSumAggregator';
import { IntegerSumAggregator } from './impl/IntegerSumAggregator';
import { BigDecimalSumAggregator } from './impl/BigDecimalSumAggregator';
import { BigIntegerSumAggregator } from './impl/BigIntegerSumAggregator';
import { FixedSumAggregator } from './impl/FixedSumAggregator';
import { FloatingPointSumAggregator } from './impl/FloatingPointSumAggregator';
import { DoubleAverageAggregator } from './impl/DoubleAverageAggregator';
import { LongAverageAggregator } from './impl/LongAverageAggregator';
import { IntegerAverageAggregator } from './impl/IntegerAverageAggregator';
import { NumberAverageAggregator } from './impl/NumberAverageAggregator';
import { BigDecimalAverageAggregator } from './impl/BigDecimalAverageAggregator';
import { BigIntegerAverageAggregator } from './impl/BigIntegerAverageAggregator';

/**
 * Port of com.hazelcast.aggregation.Aggregators.
 * Utility class to create basic Aggregator instances.
 */
export class Aggregators {
  private constructor() {}

  // --- count ---

  static count<I>(): Aggregator<I, number>;
  static count<I>(attributePath: string): Aggregator<I, number>;
  static count<I>(attributePath?: string): Aggregator<I, number> {
    return new CountAggregator<I>(attributePath);
  }

  // --- distinct ---

  static distinct<I, R>(): Aggregator<I, Set<R>>;
  static distinct<I, R>(attributePath: string): Aggregator<I, Set<R>>;
  static distinct<I, R>(attributePath?: string): Aggregator<I, Set<R>> {
    return new DistinctValuesAggregator<I, R>(attributePath);
  }

  // --- average ---

  static bigDecimalAvg<I>(): Aggregator<I, number | null>;
  static bigDecimalAvg<I>(attributePath: string): Aggregator<I, number | null>;
  static bigDecimalAvg<I>(attributePath?: string): Aggregator<I, number | null> {
    return new BigDecimalAverageAggregator<I>(attributePath);
  }

  static bigIntegerAvg<I>(): Aggregator<I, number | null>;
  static bigIntegerAvg<I>(attributePath: string): Aggregator<I, number | null>;
  static bigIntegerAvg<I>(attributePath?: string): Aggregator<I, number | null> {
    return new BigIntegerAverageAggregator<I>(attributePath);
  }

  static doubleAvg<I>(): Aggregator<I, number | null>;
  static doubleAvg<I>(attributePath: string): Aggregator<I, number | null>;
  static doubleAvg<I>(attributePath?: string): Aggregator<I, number | null> {
    return new DoubleAverageAggregator<I>(attributePath);
  }

  static integerAvg<I>(): Aggregator<I, number | null>;
  static integerAvg<I>(attributePath: string): Aggregator<I, number | null>;
  static integerAvg<I>(attributePath?: string): Aggregator<I, number | null> {
    return new IntegerAverageAggregator<I>(attributePath);
  }

  static longAvg<I>(): Aggregator<I, number | null>;
  static longAvg<I>(attributePath: string): Aggregator<I, number | null>;
  static longAvg<I>(attributePath?: string): Aggregator<I, number | null> {
    return new LongAverageAggregator<I>(attributePath);
  }

  static numberAvg<I>(): Aggregator<I, number | null>;
  static numberAvg<I>(attributePath: string): Aggregator<I, number | null>;
  static numberAvg<I>(attributePath?: string): Aggregator<I, number | null> {
    return new NumberAverageAggregator<I>(attributePath);
  }

  // --- max ---

  static bigDecimalMax<I>(): Aggregator<I, number | null>;
  static bigDecimalMax<I>(attributePath: string): Aggregator<I, number | null>;
  static bigDecimalMax<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MaxAggregator<I, number>(attributePath);
  }

  static bigIntegerMax<I>(): Aggregator<I, number | null>;
  static bigIntegerMax<I>(attributePath: string): Aggregator<I, number | null>;
  static bigIntegerMax<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MaxAggregator<I, number>(attributePath);
  }

  static doubleMax<I>(): Aggregator<I, number | null>;
  static doubleMax<I>(attributePath: string): Aggregator<I, number | null>;
  static doubleMax<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MaxAggregator<I, number>(attributePath);
  }

  static integerMax<I>(): Aggregator<I, number | null>;
  static integerMax<I>(attributePath: string): Aggregator<I, number | null>;
  static integerMax<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MaxAggregator<I, number>(attributePath);
  }

  static longMax<I>(): Aggregator<I, number | null>;
  static longMax<I>(attributePath: string): Aggregator<I, number | null>;
  static longMax<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MaxAggregator<I, number>(attributePath);
  }

  static comparableMax<I, R extends number | string>(): Aggregator<I, R | null>;
  static comparableMax<I, R extends number | string>(attributePath: string): Aggregator<I, R | null>;
  static comparableMax<I, R extends number | string>(attributePath?: string): Aggregator<I, R | null> {
    return new MaxAggregator<I, R>(attributePath);
  }

  static maxBy<I>(attributePath: string): Aggregator<I, I | null> {
    return new MaxByAggregator<I>(attributePath);
  }

  // --- min ---

  static bigDecimalMin<I>(): Aggregator<I, number | null>;
  static bigDecimalMin<I>(attributePath: string): Aggregator<I, number | null>;
  static bigDecimalMin<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MinAggregator<I, number>(attributePath);
  }

  static bigIntegerMin<I>(): Aggregator<I, number | null>;
  static bigIntegerMin<I>(attributePath: string): Aggregator<I, number | null>;
  static bigIntegerMin<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MinAggregator<I, number>(attributePath);
  }

  static doubleMin<I>(): Aggregator<I, number | null>;
  static doubleMin<I>(attributePath: string): Aggregator<I, number | null>;
  static doubleMin<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MinAggregator<I, number>(attributePath);
  }

  static integerMin<I>(): Aggregator<I, number | null>;
  static integerMin<I>(attributePath: string): Aggregator<I, number | null>;
  static integerMin<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MinAggregator<I, number>(attributePath);
  }

  static longMin<I>(): Aggregator<I, number | null>;
  static longMin<I>(attributePath: string): Aggregator<I, number | null>;
  static longMin<I>(attributePath?: string): Aggregator<I, number | null> {
    return new MinAggregator<I, number>(attributePath);
  }

  static comparableMin<I, R extends number | string>(): Aggregator<I, R | null>;
  static comparableMin<I, R extends number | string>(attributePath: string): Aggregator<I, R | null>;
  static comparableMin<I, R extends number | string>(attributePath?: string): Aggregator<I, R | null> {
    return new MinAggregator<I, R>(attributePath);
  }

  static minBy<I>(attributePath: string): Aggregator<I, I | null> {
    return new MinByAggregator<I>(attributePath);
  }

  // --- sum ---

  static bigDecimalSum<I>(): Aggregator<I, number>;
  static bigDecimalSum<I>(attributePath: string): Aggregator<I, number>;
  static bigDecimalSum<I>(attributePath?: string): Aggregator<I, number> {
    return new BigDecimalSumAggregator<I>(attributePath);
  }

  static bigIntegerSum<I>(): Aggregator<I, number>;
  static bigIntegerSum<I>(attributePath: string): Aggregator<I, number>;
  static bigIntegerSum<I>(attributePath?: string): Aggregator<I, number> {
    return new BigIntegerSumAggregator<I>(attributePath);
  }

  static doubleSum<I>(): Aggregator<I, number>;
  static doubleSum<I>(attributePath: string): Aggregator<I, number>;
  static doubleSum<I>(attributePath?: string): Aggregator<I, number> {
    return new DoubleSumAggregator<I>(attributePath);
  }

  static integerSum<I>(): Aggregator<I, number>;
  static integerSum<I>(attributePath: string): Aggregator<I, number>;
  static integerSum<I>(attributePath?: string): Aggregator<I, number> {
    return new IntegerSumAggregator<I>(attributePath);
  }

  static longSum<I>(): Aggregator<I, number>;
  static longSum<I>(attributePath: string): Aggregator<I, number>;
  static longSum<I>(attributePath?: string): Aggregator<I, number> {
    return new LongSumAggregator<I>(attributePath);
  }

  static fixedPointSum<I>(): Aggregator<I, number>;
  static fixedPointSum<I>(attributePath: string): Aggregator<I, number>;
  static fixedPointSum<I>(attributePath?: string): Aggregator<I, number> {
    return new FixedSumAggregator<I>(attributePath);
  }

  static floatingPointSum<I>(): Aggregator<I, number>;
  static floatingPointSum<I>(attributePath: string): Aggregator<I, number>;
  static floatingPointSum<I>(attributePath?: string): Aggregator<I, number> {
    return new FloatingPointSumAggregator<I>(attributePath);
  }
}
