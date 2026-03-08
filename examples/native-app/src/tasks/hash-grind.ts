/**
 * Hash grinding task for scatter worker execution.
 *
 * Performs repeated SHA-256 hashing to simulate crypto / integrity workloads.
 * Generates real CPU + memory pressure in the scatter thread pool.
 */

interface HashGrindInput {
  /** Number of hash iterations. */
  iterations: number;
  /** Seed data to hash. */
  seed: string;
  /** Optional label for tracing. */
  label?: string;
}

interface HashGrindResult {
  iterations: number;
  finalHash: string;
  durationMs: number;
  worker: string;
  label?: string;
}

export default function hashGrind(raw: unknown): HashGrindResult {
  const input = raw as HashGrindInput;
  const start = performance.now();

  let current = input.seed;
  const hasher = new Bun.CryptoHasher("sha256");

  for (let i = 0; i < input.iterations; i++) {
    hasher.update(current);
    current = hasher.digest("hex");
    hasher.update(""); // reset for next round
  }

  return {
    iterations: input.iterations,
    finalHash: current,
    durationMs: performance.now() - start,
    worker: `pid-${process.pid}`,
    label: input.label,
  };
}
