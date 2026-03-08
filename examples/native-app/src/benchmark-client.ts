#!/usr/bin/env bun

import { Helios } from "@zenystx/helios-core/Helios";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import { NearCacheConfig } from "@zenystx/helios-core/config/NearCacheConfig";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import type { NearCacheStats } from "@zenystx/helios-core/nearcache/NearCacheStats";
import {
  buildValuePayload,
  createHistogram,
  createRng,
  getBenchmarkScenario,
  recordHistogram,
  type BenchmarkClientResult,
  type NearCacheSnapshot,
} from "./benchmark-shared";

interface BenchmarkMemberClientOptions {
  clientId: string;
  clusterName: string;
  resultFile: string;
  tcpPort: number;
  peers: string[];
  expectedMembers: number;
  clientIndex: number;
  clientCount: number;
  mapName: string;
  scenario: string;
  workerCount: number;
  keyspaceSize: number;
  valueBytes: number;
  warmupSec: number;
  measureSec: number;
  samplePeriodSec: number;
  seed: number;
  startAtMs: number;
}

function parseArgs(): BenchmarkMemberClientOptions {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    values.set(arg, next);
    i++;
  }

  const required = [
    "--client-id",
    "--tcp-port",
    "--cluster-name",
    "--result-file",
    "--peers",
    "--expected-members",
    "--client-index",
    "--client-count",
    "--map-name",
    "--scenario",
    "--workers-per-client",
    "--keyspace",
    "--value-bytes",
    "--warmup",
    "--measure",
    "--sample-period",
    "--seed",
    "--start-at",
  ];
  for (const key of required) {
    if (!values.has(key)) {
      throw new Error(`Missing required flag: ${key}`);
    }
  }

  return {
    clientId: values.get("--client-id")!,
    clusterName: values.get("--cluster-name")!,
    resultFile: values.get("--result-file")!,
    tcpPort: parseInt(values.get("--tcp-port")!, 10),
    peers: values.get("--peers")!.split(",").filter(Boolean),
    expectedMembers: parseInt(values.get("--expected-members")!, 10),
    clientIndex: parseInt(values.get("--client-index")!, 10),
    clientCount: parseInt(values.get("--client-count")!, 10),
    mapName: values.get("--map-name")!,
    scenario: values.get("--scenario")!,
    workerCount: parseInt(values.get("--workers-per-client")!, 10),
    keyspaceSize: parseInt(values.get("--keyspace")!, 10),
    valueBytes: parseInt(values.get("--value-bytes")!, 10),
    warmupSec: parseInt(values.get("--warmup")!, 10),
    measureSec: parseInt(values.get("--measure")!, 10),
    samplePeriodSec: parseInt(values.get("--sample-period")!, 10),
    seed: parseInt(values.get("--seed")!, 10),
    startAtMs: parseInt(values.get("--start-at")!, 10),
  };
}

interface MutableStats {
  readOps: number;
  writeOps: number;
  errorOps: number;
  readLatencyHistogram: number[];
  writeLatencyHistogram: number[];
  overallLatencyHistogram: number[];
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const scenario = getBenchmarkScenario(opts.scenario);
  const config = new HeliosConfig(opts.clientId);
  const tcpIp = config.getNetworkConfig()
    .setPort(opts.tcpPort)
    .setPortAutoIncrement(false)
    .getJoin()
    .getTcpIpConfig()
    .setEnabled(true);

  for (const peer of opts.peers) {
    tcpIp.addMember(peer);
  }

  config.getMonitorConfig().setEnabled(false);
  config.getNetworkConfig().getRestApiConfig().setEnabled(false);

  const mapConfig = new MapConfig(opts.mapName);
  if (scenario.nearCache) {
    mapConfig.setNearCacheConfig(new NearCacheConfig());
  }
  config.addMapConfig(mapConfig);

  console.log(`[${opts.clientId}] joining cluster via ${opts.peers.join(",")}`);
  const instance = (await Helios.newInstance(config)) as HeliosInstanceImpl;
  await waitForClusterMembers(instance, opts.expectedMembers);
  console.log(`[${opts.clientId}] cluster members visible: ${instance.getCluster().getMembers().length}`);

  const map = instance.getMap<string, string>(opts.mapName);
  console.log(`[${opts.clientId}] seeding shard`);
  await seedShard(map, opts);
  console.log(`[${opts.clientId}] waiting for start`);

  const waitMs = opts.startAtMs - Date.now();
  if (waitMs > 0) {
    await Bun.sleep(waitMs);
  }

  const stats: MutableStats = {
    readOps: 0,
    writeOps: 0,
    errorOps: 0,
    readLatencyHistogram: createHistogram(),
    writeLatencyHistogram: createHistogram(),
    overallLatencyHistogram: createHistogram(),
  };
  const measureStartAt = opts.startAtMs + opts.warmupSec * 1000;
  const stopAt = measureStartAt + opts.measureSec * 1000;

  const valuePayload = buildValuePayload(opts.valueBytes, opts.clientId);
  const workers = Array.from({ length: opts.workerCount }, (_, workerIndex) =>
    runWorker(workerIndex, opts, scenario.readRatio, scenario.hotsetFraction, map, valuePayload, stats, stopAt, measureStartAt),
  );
  console.log(`[${opts.clientId}] running benchmark workers=${opts.workerCount}`);
  await Promise.allSettled(workers);

  const result: BenchmarkClientResult = {
    clientId: opts.clientId,
    scenario: scenario.name,
    workerCount: opts.workerCount,
    readOps: stats.readOps,
    writeOps: stats.writeOps,
    errorOps: stats.errorOps,
    samples: [],
    readLatencyHistogram: stats.readLatencyHistogram,
    writeLatencyHistogram: stats.writeLatencyHistogram,
    overallLatencyHistogram: stats.overallLatencyHistogram,
    nearCache: collectNearCacheSnapshot(instance.getNearCacheManager().getNearCache(opts.mapName)?.getNearCacheStats() ?? null),
  };

  instance.shutdown();
  console.log(`[${opts.clientId}] benchmark complete`);
  await Bun.write(opts.resultFile, `${JSON.stringify(result)}\n`);
  process.stdout.write(`BENCHMARK_CLIENT_RESULT_FILE ${opts.resultFile}\n`);
  process.exit(0);
}

async function waitForClusterMembers(instance: HeliosInstanceImpl, expectedMembers: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (instance.getCluster().getMembers().length >= expectedMembers) {
      return;
    }
    await Bun.sleep(200);
  }
}

async function seedShard(
  map: { set(key: string, value: string): Promise<void> },
  opts: BenchmarkMemberClientOptions,
): Promise<void> {
  const payload = buildValuePayload(opts.valueBytes, `${opts.clientId}-seed-`);
  const writes: Promise<void>[] = [];
  const batchSize = 128;

  for (let i = opts.clientIndex; i < opts.keyspaceSize; i += opts.clientCount) {
    writes.push(map.set(`bench-${i}`, `${payload}${i}`));
    if (writes.length >= batchSize) {
      await Promise.all(writes.splice(0, writes.length));
    }
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }
}

async function runWorker(
  workerIndex: number,
  opts: BenchmarkMemberClientOptions,
  readRatio: number,
  hotsetFraction: number,
  map: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> },
  valuePayload: string,
  stats: MutableStats,
  stopAt: number,
  measureStartAt: number,
): Promise<void> {
  const rng = createRng(opts.seed + workerIndex * 17 + opts.clientIndex * 101);
  const hotsetSize = Math.max(1, Math.floor(opts.keyspaceSize * hotsetFraction));
  let sequence = 0;

  while (Date.now() < stopAt) {
    const opIsRead = rng() < readRatio;
    const keyIndex = Math.floor(rng() * hotsetSize);
    const key = `bench-${keyIndex}`;
    const started = performance.now();

    try {
      if (opIsRead) {
        await map.get(key);
      } else {
        await map.set(key, `${valuePayload}${sequence++}`);
      }

      if (Date.now() >= measureStartAt) {
        const elapsed = performance.now() - started;
        recordHistogram(stats.overallLatencyHistogram, elapsed);
        if (opIsRead) {
          stats.readOps++;
          recordHistogram(stats.readLatencyHistogram, elapsed);
        } else {
          stats.writeOps++;
          recordHistogram(stats.writeLatencyHistogram, elapsed);
        }
      }
    } catch {
      if (Date.now() >= measureStartAt) {
        stats.errorOps++;
      }
    }
  }
}

function collectNearCacheSnapshot(stats: NearCacheStats | null): NearCacheSnapshot | null {
  if (stats === null) {
    return null;
  }

  return {
    hits: stats.getHits(),
    misses: stats.getMisses(),
    evictions: stats.getEvictions(),
    expirations: stats.getExpirations(),
    invalidations: stats.getInvalidations(),
    invalidationRequests: stats.getInvalidationRequests(),
    ownedEntryCount: stats.getOwnedEntryCount(),
    ownedEntryMemoryCost: stats.getOwnedEntryMemoryCost(),
    ratio: stats.getRatio(),
  };
}

main().catch((error) => {
  console.error("Fatal benchmark client error:", error);
  process.exit(1);
});
