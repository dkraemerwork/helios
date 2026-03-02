/**
 * Deterministic hash for a string key — used to route events to a shard when
 * `withParallelism(N)` is set on a pipeline with grouped aggregations.
 *
 * Routing formula:
 *   `subject = blitz.{pipelineName}.keyed.${Math.abs(hashKey(keyFn(event))) % N}`
 *
 * Implements djb2 — fast, collision-resistant enough for shard routing.
 */
export function hashKey(key: string): number {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
        // hash * 33 + charCode  (bit-shift instead of multiply for speed)
        hash = ((hash << 5) + hash) + key.charCodeAt(i);
        // Keep within 32-bit signed range to avoid float drift
        hash = hash | 0;
    }
    return hash;
}
