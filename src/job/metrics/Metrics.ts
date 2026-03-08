import { AsyncLocalStorage } from 'node:async_hooks';
import { MetricUnit } from './MetricUnit.js';
import { UserMetric } from './UserMetric.js';

/**
 * Processor metric context — holds all user-defined metrics registered by a
 * single processor instance.
 */
export interface ProcessorMetricContext {
  /** All metrics keyed by name. */
  readonly metrics: Map<string, UserMetric>;
}

/**
 * AsyncLocalStorage key that binds the current async execution context to its
 * processor metric registry. OperatorProcessor sets the store before running
 * the user function so that `Metrics.metric()` calls inside pipeline code
 * automatically bind to the right processor.
 */
export const processorMetricStore = new AsyncLocalStorage<ProcessorMetricContext>();

/**
 * Metrics — static factory for user-defined pipeline metrics.
 *
 * Mirrors Hazelcast Jet's `com.hazelcast.jet.core.metrics.Metrics`:
 *   - `metric(name)` / `metric(name, unit)` — create or retrieve a counter
 *   - The returned `UserMetric` is tied to the currently executing processor
 *     via `AsyncLocalStorage`.
 *
 * Usage inside a pipeline operator:
 * ```ts
 * const counter = Metrics.metric('itemsFiltered', MetricUnit.COUNT);
 * counter.increment();
 * ```
 *
 * When called outside an active processor context (e.g. unit tests or top-level
 * code) a module-level fallback registry is used so the call never throws.
 */
export class Metrics {
  /** Fallback registry used when no processor context is active. */
  private static readonly fallbackRegistry = new Map<string, UserMetric>();

  private constructor() {}

  /**
   * Return the `UserMetric` registered under `name` in the current processor
   * context (or the fallback registry). Creates the metric on first call.
   *
   * Subsequent calls with the same `name` return the cached instance — the
   * `unit` argument is ignored after creation (matching Jet semantics).
   */
  static metric(name: string, unit: MetricUnit = MetricUnit.COUNT): UserMetric {
    const ctx = processorMetricStore.getStore();
    const registry = ctx?.metrics ?? Metrics.fallbackRegistry;

    let existing = registry.get(name);
    if (!existing) {
      existing = new UserMetric(name, unit);
      registry.set(name, existing);
    }
    return existing;
  }

  /**
   * Snapshot all metrics in the current processor context as a plain
   * `ReadonlyMap<string, number>` for inclusion in `VertexMetrics`.
   *
   * Returns an empty map when no context is active.
   */
  static snapshotCurrentContext(): ReadonlyMap<string, number> {
    const ctx = processorMetricStore.getStore();
    if (!ctx || ctx.metrics.size === 0) return new Map();

    const snapshot = new Map<string, number>();
    for (const [name, metric] of ctx.metrics) {
      snapshot.set(name, metric.get());
    }
    return snapshot;
  }
}
