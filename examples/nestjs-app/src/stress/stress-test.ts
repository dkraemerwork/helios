#!/usr/bin/env bun
/**
 * Helios Cluster Stress Test — NestJS edition.
 *
 * Spawns 3 NestJS-backed Helios server nodes as separate Bun subprocesses,
 * then boots a lightweight 4th client node in this process to drive workloads.
 *
 * Architecture:
 *   stress-node-1  tcp=15701  rest=18081  (first — no peers)
 *   stress-node-2  tcp=15702  rest=18082  (joins via 15701)
 *   stress-node-3  tcp=15703  rest=18083  (joins via 15701)
 *   client node    tcp=15710  no REST     (connects to all 3, drives workloads)
 *
 * Workloads (run concurrently for --duration seconds):
 *   IMap put/get/delete        — partition routing + replication
 *   Near-cache reads/writes    — invalidation + cache hit ratio
 *   Cross-node partition ops   — forced network hops between hot/cold maps
 *   Scatter executor tasks     — fibonacci / hash-grind / matrix-multiply
 *
 * Management Center:
 *   Pass all three REST addresses when starting MC:
 *     MC_SERVER_PORT=9090 \
 *     MC_CLUSTERS='[{"id":"stress","displayName":"Stress Cluster",
 *       "memberAddresses":["127.0.0.1:18081","127.0.0.1:18082","127.0.0.1:18083"],
 *       "restPort":18081,"autoDiscover":false}]' \
 *     bun run packages/management-center/src/main.ts
 *
 * Usage:
 *   bun run src/stress/stress-test.ts [--duration 60] [--map-concurrency 40] ...
 */

import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { IExecutorService } from '@zenystx/helios-core/executor/IExecutorService';
import type { IMap } from '@zenystx/helios-core/map/IMap';
import { resolve } from 'path';

// ── CLI ───────────────────────────────────────────────────────────────────────

interface StressOptions {
  durationSec: number;
  mapConcurrency: number;
  nearCacheConcurrency: number;
  crossNodeConcurrency: number;
  executorConcurrency: number;
}

function parseArgs(): StressOptions {
  const args = process.argv.slice(2);
  const opts: StressOptions = {
    durationSec: 60,
    mapConcurrency: 40,
    nearCacheConcurrency: 20,
    crossNodeConcurrency: 20,
    executorConcurrency: 8,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--duration':
        opts.durationSec = parseInt(next ?? '', 10) || opts.durationSec;
        i++;
        break;
      case '--map-concurrency':
        opts.mapConcurrency = parseInt(next ?? '', 10) || opts.mapConcurrency;
        i++;
        break;
      case '--near-cache-concurrency':
        opts.nearCacheConcurrency = parseInt(next ?? '', 10) || opts.nearCacheConcurrency;
        i++;
        break;
      case '--cross-node-concurrency':
        opts.crossNodeConcurrency = parseInt(next ?? '', 10) || opts.crossNodeConcurrency;
        i++;
        break;
      case '--executor-concurrency':
        opts.executorConcurrency = parseInt(next ?? '', 10) || opts.executorConcurrency;
        i++;
        break;
      case '--help':
        console.log(`
Helios Cluster Stress Test (NestJS edition)

Usage:
  bun run src/stress/stress-test.ts [options]

Options:
  --duration <s>               Test duration in seconds (default: 60)
  --map-concurrency <n>        Concurrent IMap loops (default: 40)
  --near-cache-concurrency <n> Concurrent near-cache loops (default: 20)
  --cross-node-concurrency <n> Concurrent cross-node loops (default: 20)
  --executor-concurrency <n>   Concurrent executor loops (default: 8)
  --help                       Show this help

Management Center:
  MC_SERVER_PORT=9090 \\
  MC_CLUSTERS='[{"id":"stress","displayName":"Stress Cluster",
    "memberAddresses":["127.0.0.1:18081","127.0.0.1:18082","127.0.0.1:18083"],
    "restPort":18081,"autoDiscover":false}]' \\
  bun run packages/management-center/src/main.ts
`);
        process.exit(0);
    }
  }
  return opts;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

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

// ── Subprocess spawning ───────────────────────────────────────────────────────

interface SpawnedNode {
  name: string;
  proc: ReturnType<typeof Bun.spawn>;
  restPort: number;
}

const stressNodeScript = resolve(import.meta.dirname, 'stress-node.ts');

function spawnNode(name: string, tcpPort: number, restPort: number, peers: string[]): SpawnedNode {
  const args = [
    'bun', 'run', stressNodeScript,
    '--name', name,
    '--tcp-port', String(tcpPort),
    '--rest-port', String(restPort),
  ];
  for (const peer of peers) {
    args.push('--peer', peer);
  }

  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'inherit' });
  return { name, proc, restPort };
}

/**
 * Wait for a spawned node's stdout to contain "HELIOS_NODE_READY", then drain
 * the pipe in the background so the buffer never fills and blocks the child.
 */
async function waitForReady(node: SpawnedNode, timeoutMs = 60_000): Promise<void> {
  const stdout = node.proc.stdout;
  if (!stdout || typeof stdout === 'number') {
    throw new Error(`${node.name}: stdout is not readable`);
  }

  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = '';

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`${node.name} exited before becoming ready`);
    buffer += decoder.decode(value);
    if (buffer.includes('HELIOS_NODE_READY')) {
      // Keep draining stdout to prevent pipe-buffer deadlock in the child
      void (async () => {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
          }
        } catch { /* stream closed on shutdown */ }
      })();
      return;
    }
  }

  throw new Error(`${node.name} did not become ready within ${timeoutMs}ms`);
}

// ── Client node ───────────────────────────────────────────────────────────────

interface ClientInfo {
  instance: HeliosInstanceImpl;
  executor: IExecutorService;
  stressMap: IMap<string, unknown>;
  nearCacheMap: IMap<string, unknown>;
  hotMap: IMap<string, unknown>;
  coldMap: IMap<string, unknown>;
}

async function bootClient(): Promise<ClientInfo> {
  const tasksDir = resolve(import.meta.dirname, 'tasks');
  const config = new HeliosConfig('stress-client');

  const tcpIp = config
    .getNetworkConfig()
    .setPort(15710)
    .setPortAutoIncrement(false)
    .getJoin()
    .getTcpIpConfig()
    .setEnabled(true);

  tcpIp.addMember('127.0.0.1:15701');
  tcpIp.addMember('127.0.0.1:15702');
  tcpIp.addMember('127.0.0.1:15703');

  // Client node: no REST, no monitor — pure workload driver
  config.getNetworkConfig().getRestApiConfig().setEnabled(false);
  config.getMonitorConfig().setEnabled(false);

  config.addMapConfig(new MapConfig('stress-map'));
  config.addMapConfig(new MapConfig('hot-map'));
  config.addMapConfig(new MapConfig('cold-map'));

  const ncMapConfig = new MapConfig('near-cache-map');
  ncMapConfig.setNearCacheConfig(new NearCacheConfig());
  config.addMapConfig(ncMapConfig);

  const execConfig = new ExecutorConfig('compute');
  execConfig.setPoolSize(4);
  execConfig.setQueueCapacity(1024);
  config.addExecutorConfig(execConfig);

  process.stdout.write('[client] starting...\n');
  const instance = (await Helios.newInstance(config)) as HeliosInstanceImpl;

  const executor = instance.getExecutorService('compute');

  // Register task stubs so the RPC protocol can deserialise round-trip results
  executor.registerTaskType('fibonacci', () => { throw new Error('scatter-only'); }, {
    modulePath: resolve(tasksDir, 'fibonacci.ts'),
    exportName: 'default',
  });
  executor.registerTaskType('hash-grind', () => { throw new Error('scatter-only'); }, {
    modulePath: resolve(tasksDir, 'hash-grind.ts'),
    exportName: 'default',
  });
  executor.registerTaskType('matrix-multiply', () => { throw new Error('scatter-only'); }, {
    modulePath: resolve(tasksDir, 'matrix-multiply.ts'),
    exportName: 'default',
  });

  process.stdout.write('[client] ready\n');

  return {
    instance,
    executor,
    stressMap: instance.getMap('stress-map'),
    nearCacheMap: instance.getMap('near-cache-map'),
    hotMap: instance.getMap('hot-map'),
    coldMap: instance.getMap('cold-map'),
  };
}

// ── Workloads ─────────────────────────────────────────────────────────────────

async function mapWorkload(map: IMap<string, unknown>, stats: Stats, signal: AbortSignal): Promise<void> {
  let seq = 0;
  while (!signal.aborted) {
    const key = `k-${seq++ % 10_000}`;
    try {
      const roll = Math.random();
      if (roll < 0.5) {
        await map.set(key, seq);
        stats.mapPuts++;
      } else if (roll < 0.85) {
        await map.get(key);
        stats.mapGets++;
      } else {
        await map.delete(key);
        stats.mapDeletes++;
      }
    } catch {
      if (signal.aborted) return;
      stats.mapErrors++;
    }
  }
}

async function nearCacheWorkload(map: IMap<string, unknown>, stats: Stats, signal: AbortSignal): Promise<void> {
  let seq = 0;
  while (!signal.aborted) {
    const key = `nc-${seq++ % 5_000}`;
    try {
      if (seq % 5 === 0) {
        await map.set(key, seq);
        stats.nearCacheMisses++;
      }
      const val = await map.get(key);
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

async function executorWorkload(executor: IExecutorService, stats: Stats, signal: AbortSignal): Promise<void> {
  let seq = 0;
  while (!signal.aborted) {
    const pick = seq++ % 3;
    const label = `t-${seq}`;

    let taskType: string;
    let input: unknown;

    switch (pick) {
      case 0:
        taskType = 'fibonacci';
        input = { n: 25 + Math.floor(Math.random() * 10), label };
        break;
      case 1:
        taskType = 'hash-grind';
        input = { iterations: 500 + Math.floor(Math.random() * 1500), seed: crypto.randomUUID(), label };
        break;
      default:
        taskType = 'matrix-multiply';
        input = { size: 40 + Math.floor(Math.random() * 60), seed: Math.floor(Math.random() * 100_000), label };
    }

    try {
      stats.executorSubmitted++;
      const start = performance.now();
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

// ── Live display ──────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

let prevStats: Stats = createStats();
let prevStatsTime = 0;

function printStats(stats: Stats, elapsedSec: number, executor: IExecutorService): void {
  const now = Date.now();

  let mapRate = 0;
  let ncRate = 0;
  let xnRate = 0;
  let execRate = 0;

  if (prevStatsTime > 0) {
    const deltaSec = Math.max((now - prevStatsTime) / 1000, 0.1);

    mapRate = Math.round(
      ((stats.mapPuts + stats.mapGets + stats.mapDeletes)
        - (prevStats.mapPuts + prevStats.mapGets + prevStats.mapDeletes)) / deltaSec,
    );
    ncRate = Math.round(
      ((stats.nearCacheHits + stats.nearCacheMisses)
        - (prevStats.nearCacheHits + prevStats.nearCacheMisses)) / deltaSec,
    );
    xnRate = Math.round(
      ((stats.crossNodeWrites + stats.crossNodeReads)
        - (prevStats.crossNodeWrites + prevStats.crossNodeReads)) / deltaSec,
    );
    execRate = Math.round((stats.executorCompleted - prevStats.executorCompleted) / deltaSec);
  }

  prevStats = { ...stats };
  prevStatsTime = now;

  const totalRate = mapRate + ncRate + xnRate + execRate;
  const es = executor.getLocalExecutorStats();
  const avgLatency = stats.executorCompleted > 0
    ? `${(stats.executorTotalMs / stats.executorCompleted).toFixed(1)}ms`
    : 'n/a';

  const lines = [
    '',
    '\x1b[36m╔══════════════════════════════════════════════════════════════════════╗\x1b[0m',
    `\x1b[36m║\x1b[0m  \x1b[1mHELIOS STRESS TEST\x1b[0m  (NestJS)  — ${elapsedSec.toFixed(0)}s elapsed                    \x1b[36m║\x1b[0m`,
    '\x1b[36m╠══════════════════════════════════════════════════════════════════════╣\x1b[0m',
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
    '\x1b[36m║\x1b[0m                                                                    \x1b[36m║\x1b[0m',
    `\x1b[36m║\x1b[0m  \x1b[1;32mTOTAL THROUGHPUT: ${fmt(totalRate).padEnd(10)} ops/s\x1b[0m                              \x1b[36m║\x1b[0m`,
    '\x1b[36m╚══════════════════════════════════════════════════════════════════════╝\x1b[0m',
  ];

  process.stdout.write(`\x1b[${lines.length}A`);
  console.log(lines.join('\n'));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════════════════╗
║           HELIOS CLUSTER STRESS TEST  (NestJS edition)             ║
╠══════════════════════════════════════════════════════════════════════╣
║  Duration:               ${String(opts.durationSec).padEnd(5)}s                                   ║
║  IMap concurrency:       ${String(opts.mapConcurrency).padEnd(5)} loops                                ║
║  Near-cache concurrency: ${String(opts.nearCacheConcurrency).padEnd(5)} loops                                ║
║  Cross-node concurrency: ${String(opts.crossNodeConcurrency).padEnd(5)} loops                                ║
║  Executor concurrency:   ${String(opts.executorConcurrency).padEnd(5)} loops                                ║
╚══════════════════════════════════════════════════════════════════════╝\x1b[0m
`);

  // ── Spawn server nodes ──────────────────────────────────────────────────────

  const node1 = spawnNode('stress-node-1', 15701, 18081, []);
  process.stdout.write('[boot] waiting for stress-node-1 (first member)...\n');
  await waitForReady(node1);
  process.stdout.write('[boot] stress-node-1 ready\n');

  // Brief pause to ensure the TCP listener is fully bound before joiners connect
  await Bun.sleep(500);

  const node2 = spawnNode('stress-node-2', 15702, 18082, ['127.0.0.1:15701']);
  const node3 = spawnNode('stress-node-3', 15703, 18083, ['127.0.0.1:15701']);

  process.stdout.write('[boot] waiting for stress-node-2 and stress-node-3...\n');
  await Promise.all([waitForReady(node2), waitForReady(node3)]);
  process.stdout.write('[boot] all 3 server nodes ready\n');

  const spawnedNodes = [node1, node2, node3];

  // Let the cluster fully form before starting the client
  process.stdout.write('[boot] waiting for cluster formation...\n');
  await Bun.sleep(3_000);

  // ── Boot client node ────────────────────────────────────────────────────────

  const client = await bootClient();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (client.instance.getCluster().getMembers().length >= 4) break;
    await Bun.sleep(200);
  }

  const memberCount = client.instance.getCluster().getMembers().length;
  const transport = client.instance.getTransportStats();
  process.stdout.write(
    `[boot] cluster: ${memberCount} members, ${transport.peerCount} TCP peers, ${transport.openChannels} channels\n`,
  );
  if (memberCount < 4) {
    process.stdout.write('[boot] WARNING: expected 4 members — continuing anyway\n');
  }

  console.log(`
\x1b[1;33m  ╔══════════════════════════════════════════════════════════════════╗
  ║  Management Center:                                            ║
  ║                                                                ║
  ║  MC_SERVER_PORT=9090 \\                                         ║
  ║  MC_CLUSTERS='[{"id":"stress","displayName":"Stress Cluster",  ║
  ║    "memberAddresses":["127.0.0.1:18081","127.0.0.1:18082",     ║
  ║                       "127.0.0.1:18083"],                      ║
  ║    "restPort":18081,"autoDiscover":false}]' \\                  ║
  ║  bun run packages/management-center/src/main.ts               ║
  ╚══════════════════════════════════════════════════════════════════╝\x1b[0m
`);

  // ── Seed maps ───────────────────────────────────────────────────────────────

  process.stdout.write('[stress] seeding maps...\n');
  for (let batch = 0; batch < 5; batch++) {
    const seeds: Promise<void>[] = [];
    for (let i = batch * 100; i < (batch + 1) * 100; i++) {
      seeds.push(
        client.stressMap.set(`k-${i}`, i).catch(() => {}),
        client.nearCacheMap.set(`nc-${i}`, i).catch(() => {}),
        client.hotMap.set(`xn-${i}`, i).catch(() => {}),
      );
    }
    await Promise.all(seeds);
  }
  process.stdout.write('[stress] seeded 500 entries per map\n');

  // ── Launch workloads ────────────────────────────────────────────────────────

  console.log('\n'.repeat(20));

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

  process.stdout.write(`[stress] ${tasks.length} workload loops running\n`);

  const startTime = Date.now();
  prevStatsTime = 0;

  const statsInterval = setInterval(() => {
    printStats(stats, (Date.now() - startTime) / 1000, client.executor);
  }, 1_000);

  // ── Run for duration ────────────────────────────────────────────────────────

  await Bun.sleep(opts.durationSec * 1_000);

  // ── Shutdown ────────────────────────────────────────────────────────────────

  process.stdout.write('\n\n[stress] stopping workloads...\n');
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
    Avg task latency: ${stats.executorCompleted > 0 ? `${(stats.executorTotalMs / stats.executorCompleted).toFixed(1)}ms` : 'n/a'}
    Throughput: ${fmt(Math.round(stats.executorCompleted / totalElapsed))}/s

  \x1b[1;32mTOTAL: ${fmt(totalAll)} ops in ${totalElapsed.toFixed(1)}s = ${fmt(Math.round(totalAll / totalElapsed))}/s\x1b[0m
  \x1b[${totalErrors > 0 ? '31' : '32'}mErrors: ${fmt(totalErrors)}\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════════════╝\x1b[0m
`);

  process.stdout.write('[shutdown] killing server nodes...\n');
  for (const node of spawnedNodes) {
    node.proc.kill();
  }

  process.stdout.write('[shutdown] stopping client node...\n');
  client.instance.shutdown();

  process.stdout.write('[shutdown] done.\n');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
