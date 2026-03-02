import { Stage } from '../Stage.ts';
import type { StageContext } from '../StageContext.ts';

/**
 * Fan-in operator: passes any received value through unchanged.
 * The pipeline runtime wires multiple upstream subjects to a single `MergeOperator`,
 * achieving fan-in at the NATS subscription level.
 * At the Stage level, `process()` is a transparent pass-through.
 */
export class MergeOperator<T> extends Stage<T, T> {
  override async process(value: T, _ctx: StageContext): Promise<T> {
    return value;
  }
}
