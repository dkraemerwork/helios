export type BenchmarkScenarioName =
  | "baseline-balanced"
  | "read-heavy-uniform"
  | "read-heavy-hotset"
  | "near-cache-hotset"
  | "near-cache-with-invalidation";

export interface BenchmarkScenario {
  name: BenchmarkScenarioName;
  readRatio: number;
  writeRatio: number;
  nearCache: boolean;
  hotsetFraction: number;
  description: string;
}

export interface BenchmarkClientOptions {
  clientId: string;
  addresses: string[];
  clusterName: string;
  mapName: string;
  scenario: BenchmarkScenarioName;
  workerCount: number;
  keyspaceSize: number;
  valueBytes: number;
  warmupSec: number;
  measureSec: number;
  samplePeriodSec: number;
  seed: number;
  startAtMs: number;
}

export interface BenchmarkSample {
  sampleIndex: number;
  phase: "measurement";
  ops: number;
  reads: number;
  writes: number;
  errors: number;
}

export interface NearCacheSnapshot {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  invalidations: number;
  invalidationRequests: number;
  ownedEntryCount: number;
  ownedEntryMemoryCost: number;
  ratio: number;
}

export interface BenchmarkClientResult {
  clientId: string;
  scenario: BenchmarkScenarioName;
  workerCount: number;
  readOps: number;
  writeOps: number;
  errorOps: number;
  samples: BenchmarkSample[];
  readLatencyHistogram: number[];
  writeLatencyHistogram: number[];
  overallLatencyHistogram: number[];
  nearCache: NearCacheSnapshot | null;
}

export interface BenchmarkAggregateResult {
  schemaVersion: string;
  system: {
    name: "helios";
    runtime: string;
  };
  cluster: {
    nodeCount: number;
    clientCount: number;
    clientMode: "member" | "remote-client";
    addresses: string[];
  };
  workload: {
    mapName: string;
    scenario: BenchmarkScenarioName;
    nearCache: boolean;
    readRatio: number;
    writeRatio: number;
    hotsetFraction: number;
    keyspaceSize: number;
    valueBytes: number;
    workersPerClient: number;
    warmupSec: number;
    measureSec: number;
    samplePeriodSec: number;
    seed: number;
  };
  summary: {
    totalOps: number;
    reads: number;
    writes: number;
    errors: number;
    opsPerSec: number;
    readsPerSec: number;
    writesPerSec: number;
    latencyMs: {
      read: Percentiles;
      write: Percentiles;
      overall: Percentiles;
    };
    nearCache: NearCacheSnapshot | null;
  };
  samples: BenchmarkSample[];
  clients: BenchmarkClientResult[];
}

export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export const HISTOGRAM_MAX_MS = 1_000;
export const HISTOGRAM_SCALE = 10;

export const BENCHMARK_SCENARIOS: Record<BenchmarkScenarioName, BenchmarkScenario> = {
  "baseline-balanced": {
    name: "baseline-balanced",
    readRatio: 0.50,
    writeRatio: 0.50,
    nearCache: false,
    hotsetFraction: 1,
    description: "Balanced read/write remote map workload",
  },
  "read-heavy-uniform": {
    name: "read-heavy-uniform",
    readRatio: 0.95,
    writeRatio: 0.05,
    nearCache: false,
    hotsetFraction: 1,
    description: "Uniform read-heavy remote map workload",
  },
  "read-heavy-hotset": {
    name: "read-heavy-hotset",
    readRatio: 0.95,
    writeRatio: 0.05,
    nearCache: false,
    hotsetFraction: 0.01,
    description: "Read-heavy workload focused on a small hot set",
  },
  "near-cache-hotset": {
    name: "near-cache-hotset",
    readRatio: 0.95,
    writeRatio: 0.05,
    nearCache: true,
    hotsetFraction: 0.01,
    description: "Read-heavy hot-set workload with client near-cache enabled",
  },
  "near-cache-with-invalidation": {
    name: "near-cache-with-invalidation",
    readRatio: 0.80,
    writeRatio: 0.20,
    nearCache: true,
    hotsetFraction: 0.01,
    description: "Hot-set workload with near-cache invalidation pressure",
  },
};

export function getBenchmarkScenario(name: string): BenchmarkScenario {
  const scenario = BENCHMARK_SCENARIOS[name as BenchmarkScenarioName];
  if (!scenario) {
    throw new Error(`Unknown benchmark scenario: ${name}`);
  }
  return scenario;
}

export function createHistogram(): number[] {
  return new Array<number>(HISTOGRAM_MAX_MS * HISTOGRAM_SCALE + 1).fill(0);
}

export function recordHistogram(histogram: number[], latencyMs: number): void {
  const bucket = Math.max(0, Math.min(HISTOGRAM_MAX_MS * HISTOGRAM_SCALE, Math.floor(latencyMs * HISTOGRAM_SCALE)));
  histogram[bucket]++;
}

export function mergeHistograms(histograms: number[][]): number[] {
  const merged = createHistogram();
  for (const histogram of histograms) {
    const limit = Math.min(histogram.length, merged.length);
    for (let i = 0; i < limit; i++) {
      merged[i] += histogram[i] ?? 0;
    }
  }
  return merged;
}

export function histogramPercentiles(histogram: number[]): Percentiles {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return { p50: 0, p95: 0, p99: 0, max: 0 };
  }

  return {
    p50: histogramPercentile(histogram, total, 0.50),
    p95: histogramPercentile(histogram, total, 0.95),
    p99: histogramPercentile(histogram, total, 0.99),
    max: histogramMax(histogram),
  };
}

function histogramPercentile(histogram: number[], total: number, percentile: number): number {
  const threshold = Math.max(1, Math.ceil(total * percentile));
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i] ?? 0;
    if (seen >= threshold) {
      return i / HISTOGRAM_SCALE;
    }
  }
  return (histogram.length - 1) / HISTOGRAM_SCALE;
}

function histogramMax(histogram: number[]): number {
  for (let i = histogram.length - 1; i >= 0; i--) {
    if ((histogram[i] ?? 0) > 0) {
      return i / HISTOGRAM_SCALE;
    }
  }
  return 0;
}

export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }

  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function buildValuePayload(valueBytes: number, clientId: string): string {
  const prefix = `${clientId}-payload-`;
  if (valueBytes <= prefix.length) {
    return prefix.slice(0, valueBytes);
  }
  return prefix + "x".repeat(valueBytes - prefix.length);
}

export function formatBenchmarkSummary(result: BenchmarkAggregateResult): string {
  const summary = result.summary;
  const cache = summary.nearCache;
  return [
    "",
    "Benchmark complete",
    `- scenario: ${result.workload.scenario}`,
    `- clients: ${result.cluster.clientCount} x ${result.workload.workersPerClient} workers`,
    `- ops/s: ${summary.opsPerSec.toFixed(1)} (reads ${summary.readsPerSec.toFixed(1)}, writes ${summary.writesPerSec.toFixed(1)})`,
    `- latency ms: read p50 ${summary.latencyMs.read.p50} / p95 ${summary.latencyMs.read.p95} / p99 ${summary.latencyMs.read.p99}`,
    `- latency ms: write p50 ${summary.latencyMs.write.p50} / p95 ${summary.latencyMs.write.p95} / p99 ${summary.latencyMs.write.p99}`,
    cache === null
      ? "- near-cache: disabled"
      : `- near-cache: hits ${cache.hits}, misses ${cache.misses}, invalidations ${cache.invalidations}, ratio ${cache.ratio.toFixed(2)}%`,
  ].join("\n");
}
