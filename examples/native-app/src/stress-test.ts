#!/usr/bin/env bun
/**
 * Helios Cluster Stress Test (Subprocess Orchestrator)
 *
 * Spawns 3 Helios server nodes as separate Bun subprocesses, then boots a
 * lightweight 4th "client" node in this process to run the workloads.
 *
 * Architecture:
 *   stress-node-1 (tcp=15701, rest=18081) — master, no peers
 *   stress-node-2 (tcp=15702, rest=18082) — joins via 15701
 *   stress-node-3 (tcp=15703, rest=18083) — joins via 15701
 *   client node   (tcp=15710, no REST)    — connects to all 3, runs workloads
 *
 * Workloads:
 *  1. IMap operations — put/get/delete at high throughput
 *  2. Near-cache map  — exercises invalidation
 *  3. Cross-node partitions — writes then reads via client
 *  4. Scatter executor tasks — fibonacci, hash-grind, matrix-multiply
 *
 * Monitor dashboard:
 *   http://localhost:18081/helios/monitor?nodes=18081,18082,18083
 *
 * Usage:
 *   bun run src/stress-test.ts [--duration 60] [--map-concurrency 50] ...
 */

import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { ExecutorConfig } from "@zenystx/helios-core/config/ExecutorConfig";
import { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import { NearCacheConfig } from "@zenystx/helios-core/config/NearCacheConfig";
import { Helios } from "@zenystx/helios-core/Helios";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import type { IExecutorService } from "@zenystx/helios-core/executor/IExecutorService";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import { resolve } from "path";

/* ================================================================== */
/*  CLI                                                               */
/* ================================================================== */

interface StressOptions {
  durationSec: number;
  mapConcurrency: number;
  executorConcurrency: number;
  nearCacheConcurrency: number;
  crossNodeConcurrency: number;
}

function parseArgs(): StressOptions {
  const args = process.argv.slice(2);
  const opts: StressOptions = {
    durationSec: 60,
    mapConcurrency: 40,
    executorConcurrency: 8,
    nearCacheConcurrency: 20,
    crossNodeConcurrency: 20,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--duration":
        opts.durationSec = parseInt(next, 10) || opts.durationSec;
        i++;
        break;
      case "--map-concurrency":
        opts.mapConcurrency = parseInt(next, 10) || opts.mapConcurrency;
        i++;
        break;
      case "--executor-concurrency":
        opts.executorConcurrency = parseInt(next, 10) || opts.executorConcurrency;
        i++;
        break;
      case "--near-cache-concurrency":
        opts.nearCacheConcurrency = parseInt(next, 10) || opts.nearCacheConcurrency;
        i++;
        break;
      case "--cross-node-concurrency":
        opts.crossNodeConcurrency = parseInt(next, 10) || opts.crossNodeConcurrency;
        i++;
        break;
      case "--help":
        console.log(`
Helios Cluster Stress Test (Subprocess Orchestrator)

Usage:
  bun run src/stress-test.ts [options]

Options:
  --duration <seconds>              Test duration (default: 60)
  --map-concurrency <n>             Concurrent IMap put/get/delete loops (default: 40)
  --executor-concurrency <n>        Concurrent scatter executor task loops (default: 8)
  --near-cache-concurrency <n>      Concurrent near-cache read loops (default: 20)
  --cross-node-concurrency <n>      Concurrent cross-node partition ops (default: 20)
  --help                            Show this help

Monitor the cluster at:
  http://localhost:18081/helios/monitor?nodes=18081,18082,18083
`);
        process.exit(0);
    }
  }
  return opts;
}

/* ================================================================== */
/*  Stats                                                             */
/* ================================================================== */

interface Stats {
  mapPuts: number;
  mapGets: number;
  mapDeletes: number;
  mapErrors: number;
  nearCacheHits: number;
  nearCacheMisses: number;
  nearCacheErrors: number;
  crossNodeWrites: number;
  crossNodeReads: number;
  crossNodeErrors: number;
  executorSubmitted: number;
  executorCompleted: number;
  executorErrors: number;
  executorTotalMs: number;
}

function createStats(): Stats {
  return {
    mapPuts: 0, mapGets: 0, mapDeletes: 0, mapErrors: 0,
    nearCacheHits: 0, nearCacheMisses: 0, nearCacheErrors: 0,
    crossNodeWrites: 0, crossNodeReads: 0, crossNodeErrors: 0,
    executorSubmitted: 0, executorCompleted: 0, executorErrors: 0, executorTotalMs: 0,
  };
}

/* ================================================================== */
/*  Subprocess spawning                                               */
/* ================================================================== */

interface SpawnedNode {
  name: string;
  proc: ReturnType<typeof Bun.spawn>;
  restPort: number;
}

const stressNodeScript = resolve(import.meta.dir, "stress-node.ts");

function spawnNode(name: string, tcpPort: number, restPort: number, peers: string[]): SpawnedNode {
  const args = ["bun", "run", stressNodeScript, "--name", name, "--tcp-port", String(tcpPort), "--rest-port", String(restPort)];
  for (const peer of peers) {
    args.push("--peer", peer);
  }

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "inherit",
  });

  return { name, proc, restPort };
}

/**
 * Wait for a spawned node to print HELIOS_NODE_READY, then start a background
 * drain loop so the pipe buffer never fills up (which would block the child
 * process's event loop and stall all TCP operations).
 */
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
    if (done) throw new Error(`${node.name} exited before becoming ready`);
    buffer += decoder.decode(value);
    if (buffer.includes("HELIOS_NODE_READY")) {
      // Keep draining stdout in the background to prevent pipe buffer deadlock
      void (async () => {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
          }
        } catch {
          // stream closed — expected on shutdown
        }
      })();
      return;
    }
  }
  throw new Error(`${node.name} did not become ready within ${timeoutMs}ms`);
}

/* ================================================================== */
/*  Client node bootstrap                                             */
/* ================================================================== */

interface ClientInfo {
  instance: HeliosInstanceImpl;
  executor: IExecutorService;
  stressMap: IMap<string, unknown>;
  nearCacheMap: IMap<string, unknown>;
  hotMap: IMap<string, unknown>;
  coldMap: IMap<string, unknown>;
}

async function bootClient(): Promise<ClientInfo> {
  const clientConfig = new HeliosConfig("stress-client");

  const tcpIp = clientConfig.getNetworkConfig()
    .setPort(15710)
    .setPortAutoIncrement(false)
    .getJoin()
    .getTcpIpConfig()
    .setEnabled(true);

  tcpIp.addMember("127.0.0.1:15701");
  tcpIp.addMember("127.0.0.1:15702");
  tcpIp.addMember("127.0.0.1:15703");

  // No REST server needed for the client node
  // Monitoring disabled for the lightweight client
  clientConfig.getMonitorConfig().setEnabled(false);

  // Maps — mirror the same configs as server nodes
  clientConfig.addMapConfig(new MapConfig("stress-map"));

  const ncMapConfig = new MapConfig("near-cache-map");
  ncMapConfig.setNearCacheConfig(new NearCacheConfig());
  clientConfig.addMapConfig(ncMapConfig);

  clientConfig.addMapConfig(new MapConfig("hot-map"));
  clientConfig.addMapConfig(new MapConfig("cold-map"));

  // Executor
  const execConfig = new ExecutorConfig("compute");
  execConfig.setPoolSize(3);
  execConfig.setQueueCapacity(1024);
  clientConfig.addExecutorConfig(execConfig);

  console.log("[boot] starting client node (tcp=15710, no REST)...");
  const instance = (await Helios.newInstance(clientConfig)) as HeliosInstanceImpl;

  // Register task types for RPC protocol compatibility
  const executor = instance.getExecutorService("compute");
  const tasksDir = resolve(import.meta.dir, "tasks");

  executor.registerTaskType("fibonacci", () => { throw new Error("scatter-only"); }, {
    modulePath: resolve(tasksDir, "fibonacci.ts"),
    exportName: "default",
  });

  executor.registerTaskType("hash-grind", () => { throw new Error("scatter-only"); }, {
    modulePath: resolve(tasksDir, "hash-grind.ts"),
    exportName: "default",
  });

  executor.registerTaskType("matrix-multiply", () => { throw new Error("scatter-only"); }, {
    modulePath: resolve(tasksDir, "matrix-multiply.ts"),
    exportName: "default",
  });

  console.log("[boot] client node ready");

  return {
    instance,
    executor,
    stressMap: instance.getMap("stress-map"),
    nearCacheMap: instance.getMap("near-cache-map"),
    hotMap: instance.getMap("hot-map"),
    coldMap: instance.getMap("cold-map"),
  };
}

/* ================================================================== */
/*  Workload generators                                               */
/* ================================================================== */

/**
 * Rapid-fire IMap put/get/delete.
 * Exercises partition routing, replication, and backups across the cluster.
 * Uses compact values to minimize GC pressure.
 */
async function mapWorkload(
  stressMap: IMap<string, unknown>,
  stats: Stats,
  signal: AbortSignal,
): Promise<void> {
  let seq = 0;
  while (!signal.aborted) {
    const key = `k-${seq++ % 10_000}`;
    try {
      const op = Math.random();
      if (op < 0.50) {
        await stressMap.set(key, seq);
        stats.mapPuts++;
      } else if (op < 0.85) {
        await stressMap.get(key);
        stats.mapGets++;
      } else {
        await stressMap.delete(key);
        stats.mapDeletes++;
      }
    } catch {
      if (signal.aborted) return;
      stats.mapErrors++;
    }
  }
}

/**
 * Near-cache reads exercising cache population, hits, and invalidation.
 */
async function nearCacheWorkload(
  nearCacheMap: IMap<string, unknown>,
  stats: Stats,
  signal: AbortSignal,
): Promise<void> {
  let seq = 0;
  while (!signal.aborted) {
    const key = `nc-${seq++ % 5_000}`;
    try {
      if (seq % 5 === 0) {
        await nearCacheMap.set(key, seq);
        stats.nearCacheMisses++; // write = cache miss path
      }

      const val = await nearCacheMap.get(key);
      if (val !== null) {
        stats.nearCacheHits++;
      } else {
        stats.nearCacheMisses++;
      }
    } catch {
      if (signal.aborted) return;
      stats.nearCacheErrors++;
    }
  }
}

/**
 * Cross-node partition operations: write to hot/cold map then read back.
 * Forces partition-level network hops and backup replication.
 */
async function crossNodeWorkload(
  hotMap: IMap<string, unknown>,
  coldMap: IMap<string, unknown>,
  stats: Stats,
  signal: AbortSignal,
): Promise<void> {
  let seq = 0;
  while (!signal.aborted) {
    const map = seq % 2 === 0 ? hotMap : coldMap;
    const key = `xn-${seq++ % 10_000}`;

    try {
      await map.set(key, seq);
      stats.crossNodeWrites++;

      await map.get(key);
      stats.crossNodeReads++;
    } catch {
      if (signal.aborted) return;
      stats.crossNodeErrors++;
    }
  }
}

/**
 * Scatter executor tasks: submit CPU-bound work to scatter thread pools.
 * Cycles through fibonacci, hash-grind, and matrix-multiply.
 */
async function executorWorkload(
  executor: IExecutorService,
  stats: Stats,
  signal: AbortSignal,
): Promise<void> {
  let seq = 0;

  while (!signal.aborted) {
    const pick = seq++ % 3;
    const label = `t-${seq}`;

    let taskType: string;
    let input: unknown;

    switch (pick) {
      case 0:
        taskType = "fibonacci";
        input = { n: 25 + Math.floor(Math.random() * 10), label };
        break;
      case 1:
        taskType = "hash-grind";
        input = { iterations: 500 + Math.floor(Math.random() * 1500), seed: crypto.randomUUID(), label };
        break;
      default:
        taskType = "matrix-multiply";
        input = { size: 40 + Math.floor(Math.random() * 60), seed: Math.floor(Math.random() * 100_000), label };
        break;
    }

    try {
      stats.executorSubmitted++;
      const start = performance.now();

      // Alternate between submit() and submitToKeyOwner() for coverage
      const future = seq % 2 === 0
        ? executor.submit({ taskType, input })
        : executor.submitToKeyOwner({ taskType, input }, `scatter-key-${seq}`);

      await future.get();
      stats.executorCompleted++;
      stats.executorTotalMs += performance.now() - start;
    } catch {
      if (signal.aborted) return;
      stats.executorErrors++;
    }
  }
}

/* ================================================================== */
/*  Live stats display                                                */
/* ================================================================== */

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

let prevStats: Stats = createStats();
let prevStatsTime = 0;

function printStats(stats: Stats, elapsedSec: number, executor: IExecutorService): void {
  const now = Date.now();

  let mapRate: number;
  let ncRate: number;
  let xnRate: number;
  let execRate: number;

  if (prevStatsTime === 0) {
    // First interval — not enough data for delta yet
    mapRate = 0;
    ncRate = 0;
    xnRate = 0;
    execRate = 0;
  } else {
    const deltaSec = Math.max((now - prevStatsTime) / 1000, 0.1);

    const deltaMapOps = (stats.mapPuts + stats.mapGets + stats.mapDeletes)
      - (prevStats.mapPuts + prevStats.mapGets + prevStats.mapDeletes);
    mapRate = Math.round(deltaMapOps / deltaSec);

    const deltaNcOps = (stats.nearCacheHits + stats.nearCacheMisses)
      - (prevStats.nearCacheHits + prevStats.nearCacheMisses);
    ncRate = Math.round(deltaNcOps / deltaSec);

    const deltaXnOps = (stats.crossNodeWrites + stats.crossNodeReads)
      - (prevStats.crossNodeWrites + prevStats.crossNodeReads);
    xnRate = Math.round(deltaXnOps / deltaSec);

    const deltaExecOps = stats.executorCompleted - prevStats.executorCompleted;
    execRate = Math.round(deltaExecOps / deltaSec);
  }

  prevStats = { ...stats };
  prevStatsTime = now;

  const totalRate = mapRate + ncRate + xnRate + execRate;

  const es = executor.getLocalExecutorStats();
  const avgLatency = stats.executorCompleted > 0
    ? `${(stats.executorTotalMs / stats.executorCompleted).toFixed(1)}ms`
    : "n/a";

  const lines = [
    ``,
    `\x1b[36m╔══════════════════════════════════════════════════════════════════════╗\x1b[0m`,
    `\x1b[36m║\x1b[0m  \x1b[1mHELIOS STRESS TEST\x1b[0m — ${elapsedSec.toFixed(0)}s elapsed                                   \x1b[36m║\x1b[0m`,
    `\x1b[36m╠══════════════════════════════════════════════════════════════════════╣\x1b[0m`,
    `\x1b[36m║\x1b[0m  \x1b[33mIMap Operations\x1b[0m                           \x1b[32m${fmt(mapRate).padStart(8)}/s\x1b[0m            \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m    puts: ${fmt(stats.mapPuts).padEnd(10)} gets: ${fmt(stats.mapGets).padEnd(10)} del: ${fmt(stats.mapDeletes).padEnd(10)}     \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m    errors: ${fmt(stats.mapErrors).padEnd(52)}    \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  \x1b[33mNear-Cache\x1b[0m                                \x1b[32m${fmt(ncRate).padStart(8)}/s\x1b[0m            \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m    hits: ${fmt(stats.nearCacheHits).padEnd(12)} misses: ${fmt(stats.nearCacheMisses).padEnd(10)} err: ${fmt(stats.nearCacheErrors).padEnd(6)} \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  \x1b[33mCross-Node Partitions\x1b[0m                     \x1b[32m${fmt(xnRate).padStart(8)}/s\x1b[0m            \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m    writes: ${fmt(stats.crossNodeWrites).padEnd(10)} reads: ${fmt(stats.crossNodeReads).padEnd(10)} err: ${fmt(stats.crossNodeErrors).padEnd(6)}   \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  \x1b[33mScatter Executors\x1b[0m                         \x1b[32m${fmt(execRate).padStart(8)}/s\x1b[0m            \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m    submitted: ${fmt(stats.executorSubmitted).padEnd(8)} done: ${fmt(stats.executorCompleted).padEnd(8)} err: ${fmt(stats.executorErrors).padEnd(8)}      \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m    \x1b[35mactive workers: ${String(es.activeWorkers).padEnd(4)}\x1b[0m  pending: ${String(es.pending).padEnd(6)} avg: ${avgLatency.padEnd(10)}    \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m                                                                    \x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  \x1b[1;32mTOTAL THROUGHPUT: ${fmt(totalRate).padEnd(10)} ops/s\x1b[0m                              \x1b[36m║\x1b[0m`,
    `\x1b[36m╚══════════════════════════════════════════════════════════════════════╝\x1b[0m`,
  ];

  process.stdout.write(`\x1b[${lines.length}A`);
  console.log(lines.join("\n"));
}

/* ================================================================== */
/*  Main                                                              */
/* ================================================================== */

async function main(): Promise<void> {
  const opts = parseArgs();
  const totalLoops = opts.mapConcurrency + opts.nearCacheConcurrency
    + opts.crossNodeConcurrency + opts.executorConcurrency;

  console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════════════════╗
║              HELIOS CLUSTER STRESS TEST                            ║
╠══════════════════════════════════════════════════════════════════════╣
║  Duration:              ${String(opts.durationSec).padEnd(6)}s                                   ║
║  IMap concurrency:      ${String(opts.mapConcurrency).padEnd(6)} loops                                ║
║  Near-cache concurrency:${String(opts.nearCacheConcurrency).padEnd(6)} loops                                ║
║  Cross-node concurrency:${String(opts.crossNodeConcurrency).padEnd(6)} loops                                ║
║  Executor concurrency:  ${String(opts.executorConcurrency).padEnd(6)} loops  (scatter workers)            ║
║  Total concurrent loops:${String(totalLoops).padEnd(6)}                                      ║
╚══════════════════════════════════════════════════════════════════════╝\x1b[0m
`);

  /* ── Spawn server nodes ───────────────────────────────────────── */

  // Spawn node 1 first (becomes master) — wait for it before starting joiners
  const node1 = spawnNode("stress-node-1", 15701, 18081, []);
  console.log("[boot] waiting for stress-node-1 (master)...");
  await waitForReady(node1);
  console.log("[boot] stress-node-1 ready — spawning joiners...");

  // Small pause so TCP listener is fully bound
  await Bun.sleep(500);

  const node2 = spawnNode("stress-node-2", 15702, 18082, ["127.0.0.1:15701"]);
  const node3 = spawnNode("stress-node-3", 15703, 18083, ["127.0.0.1:15701"]);
  await Promise.all([waitForReady(node2), waitForReady(node3)]);

  const spawnedNodes: SpawnedNode[] = [node1, node2, node3];

  console.log("[boot] all 3 server nodes ready — waiting for cluster formation...");
  await Bun.sleep(3_000);

  /* ── Boot client node ─────────────────────────────────────────── */

  const client = await bootClient();

  // Wait for the client to see the full cluster (4 members: 3 servers + client)
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const count = client.instance.getCluster().getMembers().length;
    if (count >= 4) break;
    await Bun.sleep(200);
  }

  const memberCount = client.instance.getCluster().getMembers().length;
  const transportStats = client.instance.getTransportStats();
  console.log(`[boot] client joined cluster: ${memberCount} members visible, ${transportStats.peerCount} TCP peers, ${transportStats.openChannels} channels`);
  if (memberCount < 4) {
    console.warn("[boot] WARNING: cluster did not reach 4 members — continuing anyway");
  }

  // Log partition distribution
  let localPartitions = 0;
  let remotePartitions = 0;
  const localMemberId = client.instance.getName();
  for (let p = 0; p < 271; p++) {
    const ownerId = client.instance.getPartitionOwnerId(p);
    if (ownerId === localMemberId) localPartitions++;
    else remotePartitions++;
  }
  console.log(`[boot] partitions: ${localPartitions} local, ${remotePartitions} remote`);

  console.log(`
\x1b[1;33m  ┌──────────────────────────────────────────────────────────────┐
  │  MONITOR DASHBOARD:                                        │
  │  http://localhost:18081/helios/monitor?nodes=18081,18082,18083  │
  │                                                            │
  │  Open in your browser to watch the cluster under load.     │
  └──────────────────────────────────────────────────────────────┘\x1b[0m
`);

  /* ── Seed maps with initial data ──────────────────────────────── */

  console.log("[stress] seeding maps...");

  // Seed in small batches to avoid overwhelming the cluster during formation
  for (let batch = 0; batch < 5; batch++) {
    const seedPromises: Promise<void>[] = [];
    for (let i = batch * 100; i < (batch + 1) * 100; i++) {
      seedPromises.push(
        client.stressMap.set(`k-${i}`, i).catch(() => {}),
        client.nearCacheMap.set(`nc-${i}`, i).catch(() => {}),
        client.hotMap.set(`xn-${i}`, i).catch(() => {}),
      );
    }
    await Promise.all(seedPromises);
  }

  console.log("[stress] seeded 500 entries per map");

  /* ── Launch workloads ─────────────────────────────────────────── */

  // Reserve blank lines for stats display
  console.log("\n".repeat(20));

  const abort = new AbortController();
  const stats = createStats();
  const tasks: Promise<void>[] = [];

  for (let i = 0; i < opts.mapConcurrency; i++) {
    tasks.push(mapWorkload(client.stressMap, stats, abort.signal));
  }

  for (let i = 0; i < opts.nearCacheConcurrency; i++) {
    tasks.push(nearCacheWorkload(client.nearCacheMap, stats, abort.signal));
  }

  for (let i = 0; i < opts.crossNodeConcurrency; i++) {
    tasks.push(crossNodeWorkload(client.hotMap, client.coldMap, stats, abort.signal));
  }

  for (let i = 0; i < opts.executorConcurrency; i++) {
    tasks.push(executorWorkload(client.executor, stats, abort.signal));
  }

  console.log(`[stress] ${tasks.length} workload loops running`);

  /* ── Stats display loop ───────────────────────────────────────── */

  const startTime = Date.now();
  prevStatsTime = 0; // reset so first interval shows "warming up" (0/s)

  const statsInterval = setInterval(() => {
    printStats(stats, (Date.now() - startTime) / 1000, client.executor);
  }, 1_000);

  /* ── Run for duration ─────────────────────────────────────────── */

  await Bun.sleep(opts.durationSec * 1000);

  /* ── Shutdown ─────────────────────────────────────────────────── */

  console.log("\n\n[stress] stopping workloads...");
  abort.abort();
  clearInterval(statsInterval);

  await Promise.race([Promise.allSettled(tasks), Bun.sleep(5_000)]);

  const totalElapsed = (Date.now() - startTime) / 1000;
  const totalMap = stats.mapPuts + stats.mapGets + stats.mapDeletes;
  const totalNc = stats.nearCacheHits + stats.nearCacheMisses;
  const totalXn = stats.crossNodeWrites + stats.crossNodeReads;
  const totalAll = totalMap + totalNc + totalXn + stats.executorCompleted;
  const totalErrors = stats.mapErrors + stats.nearCacheErrors + stats.crossNodeErrors + stats.executorErrors;

  console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════════════════╗
║                       FINAL RESULTS                                ║
╠══════════════════════════════════════════════════════════════════════╣\x1b[0m
  Duration: ${totalElapsed.toFixed(1)}s

  \x1b[33mIMap\x1b[0m
    Puts: ${fmt(stats.mapPuts)}   Gets: ${fmt(stats.mapGets)}   Deletes: ${fmt(stats.mapDeletes)}
    Errors: ${fmt(stats.mapErrors)}   Throughput: ${fmt(Math.round(totalMap / totalElapsed))}/s

  \x1b[33mNear-Cache\x1b[0m
    Hits: ${fmt(stats.nearCacheHits)}   Misses: ${fmt(stats.nearCacheMisses)}
    Errors: ${fmt(stats.nearCacheErrors)}   Throughput: ${fmt(Math.round(totalNc / totalElapsed))}/s

  \x1b[33mCross-Node Partitions\x1b[0m
    Writes: ${fmt(stats.crossNodeWrites)}   Reads: ${fmt(stats.crossNodeReads)}
    Errors: ${fmt(stats.crossNodeErrors)}   Throughput: ${fmt(Math.round(totalXn / totalElapsed))}/s

  \x1b[33mScatter Executors\x1b[0m
    Submitted: ${fmt(stats.executorSubmitted)}   Completed: ${fmt(stats.executorCompleted)}   Errors: ${fmt(stats.executorErrors)}
    Avg task latency: ${stats.executorCompleted > 0 ? `${(stats.executorTotalMs / stats.executorCompleted).toFixed(1)}ms` : "n/a"}
    Throughput: ${fmt(Math.round(stats.executorCompleted / totalElapsed))}/s

  \x1b[1;32mTOTAL: ${fmt(totalAll)} ops in ${totalElapsed.toFixed(1)}s = ${fmt(Math.round(totalAll / totalElapsed))}/s\x1b[0m
  \x1b[${totalErrors > 0 ? "31" : "32"}mErrors: ${fmt(totalErrors)}\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════════════╝\x1b[0m
`);

  console.log("[shutdown] killing server nodes...");
  for (const node of spawnedNodes) {
    node.proc.kill();
  }

  console.log("[shutdown] stopping client node...");
  client.instance.shutdown();

  console.log("[shutdown] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
