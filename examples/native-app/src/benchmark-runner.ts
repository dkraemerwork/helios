import { formatBenchmarkSummary, getBenchmarkScenario, histogramPercentiles, mergeHistograms, type BenchmarkAggregateResult, type BenchmarkClientResult, type BenchmarkSample } from "./benchmark-shared";
import { resolve } from "path";

interface BenchmarkOptions {
  scenario: string;
  warmupSec: number;
  measureSec: number;
  clients: number;
  workersPerClient: number;
  keyspaceSize: number;
  valueBytes: number;
  samplePeriodSec: number;
  seed: number;
  outputFile: string | null;
  clusterName: string;
  mapName: string;
  monitor: boolean;
}

interface SpawnedNode {
  name: string;
  proc: ReturnType<typeof Bun.spawn>;
}

const stressNodeScript = resolve(import.meta.dir, "stress-node.ts");
const benchmarkClientScript = resolve(import.meta.dir, "benchmark-client.ts");
const serverAddresses = ["127.0.0.1:15701", "127.0.0.1:15702", "127.0.0.1:15703"];

export function shouldRunBenchmark(args: string[]): boolean {
  return args.includes("--mode") && args.includes("benchmark");
}

export async function runBenchmarkFromCli(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const scenario = getBenchmarkScenario(opts.scenario);
  const nodes = await bootServers(opts.clusterName, opts.monitor);

  try {
    const results = await runClients(opts);
    const aggregate = aggregateResults(opts, results);

    if (opts.outputFile !== null) {
      await Bun.write(opts.outputFile, `${JSON.stringify(aggregate, null, 2)}\n`);
      console.log(`- wrote benchmark result to ${opts.outputFile}`);
    }

    console.log(formatBenchmarkSummary(aggregate));
    console.log(`- scenario description: ${scenario.description}`);
  } finally {
    for (const node of nodes) {
      node.proc.kill();
    }
  }
}

function parseArgs(args: string[]): BenchmarkOptions {
  const opts: BenchmarkOptions = {
    scenario: "baseline-balanced",
    warmupSec: 15,
    measureSec: 30,
    clients: 1,
    workersPerClient: 8,
    keyspaceSize: 10_000,
    valueBytes: 256,
    samplePeriodSec: 1,
    seed: 1337,
    outputFile: null,
    clusterName: "bench-cluster",
    mapName: "bench-map",
    monitor: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--mode":
        i++;
        break;
      case "--scenario":
        opts.scenario = next ?? opts.scenario;
        i++;
        break;
      case "--warmup":
        opts.warmupSec = parseInt(next ?? "", 10) || opts.warmupSec;
        i++;
        break;
      case "--measure":
        opts.measureSec = parseInt(next ?? "", 10) || opts.measureSec;
        i++;
        break;
      case "--clients":
        opts.clients = parseInt(next ?? "", 10) || opts.clients;
        i++;
        break;
      case "--workers-per-client":
        opts.workersPerClient = parseInt(next ?? "", 10) || opts.workersPerClient;
        i++;
        break;
      case "--keyspace":
        opts.keyspaceSize = parseInt(next ?? "", 10) || opts.keyspaceSize;
        i++;
        break;
      case "--value-bytes":
        opts.valueBytes = parseInt(next ?? "", 10) || opts.valueBytes;
        i++;
        break;
      case "--sample-period":
        opts.samplePeriodSec = parseInt(next ?? "", 10) || opts.samplePeriodSec;
        i++;
        break;
      case "--seed":
        opts.seed = parseInt(next ?? "", 10) || opts.seed;
        i++;
        break;
      case "--output-file":
        opts.outputFile = next ?? null;
        i++;
        break;
      case "--cluster-name":
        opts.clusterName = next ?? opts.clusterName;
        i++;
        break;
      case "--map-name":
        opts.mapName = next ?? opts.mapName;
        i++;
        break;
      case "--monitor":
        opts.monitor = (next ?? "false") === "true";
        i++;
        break;
      case "--help":
        printHelp();
        process.exit(0);
        break;
    }
  }

  void getBenchmarkScenario(opts.scenario);
  return opts;
}

function printHelp(): void {
  console.log(`
Helios benchmark mode

Usage:
  bun run src/stress-test.ts --mode benchmark [options]

Options:
  --scenario <name>               baseline-balanced | read-heavy-uniform | read-heavy-hotset | near-cache-hotset | near-cache-with-invalidation
  --warmup <seconds>              Warmup duration (default: 15)
  --measure <seconds>             Measurement duration (default: 30)
  --clients <n>                   Number of external clients (default: 1)
  --workers-per-client <n>        Concurrent loops per client (default: 8)
  --keyspace <n>                  Number of seeded keys (default: 10000)
  --value-bytes <n>               Value payload size (default: 256)
  --sample-period <seconds>       Sample interval (default: 1)
  --seed <n>                      Deterministic seed (default: 1337)
  --output-file <path>            Write final JSON result to file
  --monitor <true|false>          Enable server monitor/REST (default: false)
  --help                          Show this help
`);
}

function spawnNode(processLabel: string, _clusterName: string, tcpPort: number, restPort: number, peers: string[], monitor: boolean): SpawnedNode {
  const args = [
    "bun",
    "run",
    stressNodeScript,
    "--name", processLabel,
    "--tcp-port", String(tcpPort),
    "--rest-port", String(restPort),
      "--enable-rest", String(monitor),
      "--enable-monitor", String(monitor),
  ];
  for (const peer of peers) {
    args.push("--peer", peer);
  }

  return {
    name: processLabel,
    proc: Bun.spawn(args, { stdout: "pipe", stderr: "inherit" }),
  };
}

async function waitForReady(node: SpawnedNode, timeoutMs = 30_000): Promise<void> {
  const stdout = node.proc.stdout;
  if (!stdout || typeof stdout === "number") {
    throw new Error(`${node.name} stdout is not a ReadableStream`);
  }
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = "";

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) {
      throw new Error(`${node.name} exited before becoming ready`);
    }
    buffer += decoder.decode(value);
    if (buffer.includes("HELIOS_NODE_READY")) {
      void (async () => {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
          }
        } catch {
        }
      })();
      return;
    }
  }

  throw new Error(`${node.name} did not become ready within ${timeoutMs}ms`);
}

async function bootServers(clusterName: string, monitor: boolean): Promise<SpawnedNode[]> {
  console.log("[boot] starting benchmark cluster...");
  const node1 = spawnNode("bench-node-1", clusterName, 15701, 18081, [], monitor);
  await waitForReady(node1);
  await Bun.sleep(500);

  const node2 = spawnNode("bench-node-2", clusterName, 15702, 18082, ["127.0.0.1:15701"], monitor);
  const node3 = spawnNode("bench-node-3", clusterName, 15703, 18083, ["127.0.0.1:15701"], monitor);
  await Promise.all([waitForReady(node2), waitForReady(node3)]);
  await Bun.sleep(3_000);
  console.log("[boot] benchmark cluster ready");
  return [node1, node2, node3];
}

async function runClients(opts: BenchmarkOptions): Promise<BenchmarkClientResult[]> {
  const startAtMs = Date.now() + 10_000;
  const procs = Array.from({ length: opts.clients }, (_, index) => {
    const clientId = `bench-client-${index + 1}`;
    const resultFile = `/tmp/helios-benchmark-${clientId}-${Date.now()}.json`;
    const args = [
      "bun",
      "run",
      benchmarkClientScript,
      "--client-id", clientId,
      "--cluster-name", opts.clusterName,
      "--result-file", resultFile,
      "--tcp-port", String(15810 + index),
      "--peers", serverAddresses.join(","),
      "--expected-members", String(3 + opts.clients),
      "--client-index", String(index),
      "--client-count", String(opts.clients),
      "--map-name", opts.mapName,
      "--scenario", opts.scenario,
      "--workers-per-client", String(opts.workersPerClient),
      "--keyspace", String(opts.keyspaceSize),
      "--value-bytes", String(opts.valueBytes),
      "--warmup", String(opts.warmupSec),
      "--measure", String(opts.measureSec),
      "--sample-period", String(opts.samplePeriodSec),
      "--seed", String(opts.seed + index * 1000),
      "--start-at", String(startAtMs),
    ];

    return {
      clientId,
      resultFile,
      proc: Bun.spawn(args, { stdout: "inherit", stderr: "inherit" }),
    };
  });

  console.log(`[bench] running ${opts.clients} member-clients against 3 servers`);
  const results: BenchmarkClientResult[] = [];

  for (const entry of procs) {
    console.log(`[bench] waiting for ${entry.clientId}...`);
    const exitCode = await entry.proc.exited;
    console.log(`[bench] ${entry.clientId} exited with code ${exitCode}`);
    if (exitCode !== 0) {
      throw new Error(`${entry.clientId} exited with code ${exitCode}`);
    }
    console.log(`[bench] reading ${entry.resultFile}`);
    const payload = await Bun.file(entry.resultFile).text();
    results.push(JSON.parse(payload) as BenchmarkClientResult);
  }

  return results;
}

function aggregateResults(opts: BenchmarkOptions, clients: BenchmarkClientResult[]): BenchmarkAggregateResult {
  const scenario = getBenchmarkScenario(opts.scenario);
  const totalReads = clients.reduce((sum, client) => sum + client.readOps, 0);
  const totalWrites = clients.reduce((sum, client) => sum + client.writeOps, 0);
  const totalErrors = clients.reduce((sum, client) => sum + client.errorOps, 0);
  const totalOps = totalReads + totalWrites;
  const duration = Math.max(1, opts.measureSec);
  const readHistogram = mergeHistograms(clients.map((client) => client.readLatencyHistogram));
  const writeHistogram = mergeHistograms(clients.map((client) => client.writeLatencyHistogram));
  const overallHistogram = mergeHistograms(clients.map((client) => client.overallLatencyHistogram));
  const nearCache = mergeNearCache(clients);
  const samples = mergeSamples(clients);

  return {
    schemaVersion: "1.0.0",
    system: {
      name: "helios",
      runtime: `bun ${Bun.version}`,
    },
    cluster: {
      nodeCount: 3,
      clientCount: opts.clients,
      clientMode: "member",
      addresses: [...serverAddresses],
    },
    workload: {
      mapName: opts.mapName,
      scenario: scenario.name,
      nearCache: scenario.nearCache,
      readRatio: scenario.readRatio,
      writeRatio: scenario.writeRatio,
      hotsetFraction: scenario.hotsetFraction,
      keyspaceSize: opts.keyspaceSize,
      valueBytes: opts.valueBytes,
      workersPerClient: opts.workersPerClient,
      warmupSec: opts.warmupSec,
      measureSec: opts.measureSec,
      samplePeriodSec: opts.samplePeriodSec,
      seed: opts.seed,
    },
    summary: {
      totalOps,
      reads: totalReads,
      writes: totalWrites,
      errors: totalErrors,
      opsPerSec: totalOps / duration,
      readsPerSec: totalReads / duration,
      writesPerSec: totalWrites / duration,
      latencyMs: {
        read: histogramPercentiles(readHistogram),
        write: histogramPercentiles(writeHistogram),
        overall: histogramPercentiles(overallHistogram),
      },
      nearCache,
    },
    samples,
    clients,
  };
}

function mergeNearCache(clients: BenchmarkClientResult[]) {
  let found = false;
  const totals = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
    invalidations: 0,
    invalidationRequests: 0,
    ownedEntryCount: 0,
    ownedEntryMemoryCost: 0,
    ratio: 0,
  };

  for (const client of clients) {
    if (client.nearCache === null) {
      continue;
    }
    found = true;
    totals.hits += client.nearCache.hits;
    totals.misses += client.nearCache.misses;
    totals.evictions += client.nearCache.evictions;
    totals.expirations += client.nearCache.expirations;
    totals.invalidations += client.nearCache.invalidations;
    totals.invalidationRequests += client.nearCache.invalidationRequests;
    totals.ownedEntryCount += client.nearCache.ownedEntryCount;
    totals.ownedEntryMemoryCost += client.nearCache.ownedEntryMemoryCost;
  }

  if (!found) {
    return null;
  }

  const totalLookups = totals.hits + totals.misses;
  totals.ratio = totalLookups === 0 ? 0 : (totals.hits * 100) / totalLookups;
  return totals;
}

function mergeSamples(clients: BenchmarkClientResult[]): BenchmarkSample[] {
  const merged = new Map<number, BenchmarkSample>();
  for (const client of clients) {
    for (const sample of client.samples) {
      const existing = merged.get(sample.sampleIndex);
      if (existing) {
        existing.ops += sample.ops;
        existing.reads += sample.reads;
        existing.writes += sample.writes;
        existing.errors += sample.errors;
      } else {
        merged.set(sample.sampleIndex, { ...sample });
      }
    }
  }
  return [...merged.values()].sort((a, b) => a.sampleIndex - b.sampleIndex);
}
