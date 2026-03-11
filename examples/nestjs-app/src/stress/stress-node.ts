#!/usr/bin/env bun
/**
 * Helios Stress Node — NestJS edition.
 *
 * Boots a full NestJS application context backed by a clustered HeliosInstance.
 * Spawned by stress-test.ts as a subprocess; one process per cluster member.
 *
 * Each node:
 *   - Joins the Helios TCP cluster via configured peers
 *   - Enables the REST + monitor endpoint so the Management Center can observe it
 *   - Registers scatter executor tasks (fibonacci, hash-grind, matrix-multiply)
 *   - Prints "HELIOS_NODE_READY" when fully initialised
 *
 * Usage (via stress-test.ts — not meant to be run directly):
 *   bun run src/stress/stress-node.ts \
 *     --name stress-node-1 --tcp-port 15701 --rest-port 18081 \
 *     [--peer 127.0.0.1:15702] [--peer 127.0.0.1:15703]
 */

import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { BlitzService } from '@zenystx/helios-blitz';
import { HELIOS_BLITZ_SERVICE_TOKEN, HeliosBlitzModule, HeliosBlitzService } from '@zenystx/helios-blitz/nestjs';
import { HeliosModule } from '@zenystx/helios-nestjs';
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { QueueConfig } from '@zenystx/helios-core/config/QueueConfig';
import { TopicConfig } from '@zenystx/helios-core/config/TopicConfig';
import type { IQueue } from '@zenystx/helios-core/collection/IQueue';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { ITopic } from '@zenystx/helios-core/topic/ITopic';
import type { DynamicModule } from '@nestjs/common';
import { resolve } from 'path';
import 'reflect-metadata';
import { BinanceBlitzJobsService } from '../binance-quotes/binance-blitz-jobs.service';
import { BinanceQuotesModule } from '../binance-quotes/binance-quotes.module';
import {
  BINANCE_MARKET_ROLLUPS_JOB_NAME,
  buildMemberQueueCandidates,
  COLD_MAP_NAME,
  HOT_MAP_NAME,
  MARKET_TICKS_SUBJECT,
  NEAR_CACHE_MAP_NAME,
  QUOTE_ROLLUPS_MAP_NAME,
  STRESS_MAP_NAME,
  STRESS_JOB_HOST_NATS_PORT,
  STRESS_MEMBER_TOPIC_NAME,
  STRESS_QUEUE_NAME,
  STRESS_TOPIC_NAME,
} from './stress-shared';

// ── CLI ───────────────────────────────────────────────────────────────────────

interface NodeOptions {
  name: string;
  tcpPort: number;
  restPort: number;
  expectedMembers: number;
  peers: string[];
}

function parseArgs(): NodeOptions {
  const args = process.argv.slice(2);
  const opts: NodeOptions = {
    name: 'stress-node',
    tcpPort: 15701,
    restPort: 18081,
    expectedMembers: 3,
    peers: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--name':
        opts.name = next ?? opts.name;
        i++;
        break;
      case '--tcp-port':
        opts.tcpPort = parseInt(next ?? '', 10) || opts.tcpPort;
        i++;
        break;
      case '--rest-port':
        opts.restPort = parseInt(next ?? '', 10) || opts.restPort;
        i++;
        break;
      case '--expected-members':
        opts.expectedMembers = parseInt(next ?? '', 10) || opts.expectedMembers;
        i++;
        break;
      case '--peer':
        if (next) opts.peers.push(next);
        i++;
        break;
    }
  }

  return opts;
}

// ── NestJS app module ─────────────────────────────────────────────────────────

@Module({})
class StressNodeModule {
  static create(instance: HeliosInstanceImpl, blitzService: BlitzService | null): DynamicModule {
    const imports: NonNullable<DynamicModule['imports']> = [HeliosModule.forRoot(instance)];

    if (blitzService !== null) {
      imports.push(
        HeliosBlitzModule.forHeliosInstance({
          provide: HELIOS_BLITZ_SERVICE_TOKEN,
          useFactory: () => new HeliosBlitzService(blitzService),
        }),
        BinanceQuotesModule,
      );
    }

    return {
      module: StressNodeModule,
      imports,
    };
  }
}

function isJobHostNode(nodeName: string): boolean {
  return nodeName === 'stress-node-1';
}

interface MemberQueueItem {
  seq: number;
  producer: string;
  createdAt: number;
}

interface MemberTopicMessage {
  seq: number;
  publisher: string;
  emittedAt: number;
}

async function waitForClusterSize(
  instance: HeliosInstanceImpl,
  expectedMembers: number,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    if (instance.getCluster().getMembers().length >= expectedMembers) {
      return;
    }
    await Bun.sleep(200);
  }

  if (!signal.aborted) {
    throw new Error(`Cluster did not reach ${expectedMembers} monitored members within ${timeoutMs}ms`);
  }
}

async function resolveLocalQueueName(instance: HeliosInstanceImpl, nodeName: string): Promise<string> {
  const localMemberId = instance.getCluster().getLocalMember().getUuid();

  for (const queueName of buildMemberQueueCandidates(nodeName, 128)) {
    const partitionId = instance.getPartitionIdForName(queueName);
    const ownerId = instance.getPartitionOwnerId(partitionId);
    if (ownerId === localMemberId) {
      return queueName;
    }
  }

  throw new Error(`Unable to resolve a member-local queue for ${nodeName}`);
}

async function memberQueueWorkload(
  queue: IQueue<MemberQueueItem>,
  producer: string,
  signal: AbortSignal,
): Promise<void> {
  let seq = 0;
  while (!signal.aborted) {
    const iteration = seq;
    const value: MemberQueueItem = { seq, producer, createdAt: Date.now() };
    seq++;

    try {
      await queue.offer(value);
      if (seq % 2 === 0 || (await queue.size()) > 32) {
        await queue.poll();
      }
    } catch {
      if (signal.aborted) {
        return;
      }
    }

    if (iteration % 32 === 0) {
      await Bun.sleep(0);
    }
  }
}

async function memberTopicWorkload(
  topic: ITopic<MemberTopicMessage>,
  publisher: string,
  signal: AbortSignal,
): Promise<void> {
  let seq = 0;
  while (!signal.aborted) {
    const iteration = seq;

    try {
      await topic.publish({ seq, publisher, emittedAt: Date.now() });
      seq++;
    } catch {
      if (signal.aborted) {
        return;
      }
    }

    if (iteration % 32 === 0) {
      await Bun.sleep(0);
    }
  }
}

async function startMemberLocalTraffic(
  instance: HeliosInstanceImpl,
  opts: NodeOptions,
  signal: AbortSignal,
): Promise<void> {
  await waitForClusterSize(instance, opts.expectedMembers, signal);
  if (signal.aborted) {
    return;
  }

  await Bun.sleep(750);
  const queueName = await resolveLocalQueueName(instance, opts.name);
  const queue = instance.getQueue<MemberQueueItem>(queueName);
  const topic = instance.getTopic<MemberTopicMessage>(STRESS_MEMBER_TOPIC_NAME);

  const queueListenerId = queue.addItemListener({
    itemAdded: () => {},
    itemRemoved: () => {},
  });
  const topicListenerId = topic.addMessageListener(() => {});

  process.stdout.write(
    `[${opts.name}] member-local queue/topic traffic active queue=${queueName} topic=${STRESS_MEMBER_TOPIC_NAME}\n`,
  );

  try {
    await Promise.all([
      memberQueueWorkload(queue, opts.name, signal),
      memberTopicWorkload(topic, opts.name, signal),
    ]);
  } finally {
    queue.removeItemListener(queueListenerId);
    topic.removeMessageListener(topicListenerId);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  const tasksDir = resolve(import.meta.dirname, 'tasks');
  const jobHost = isJobHostNode(opts.name);

  // ── Helios config ───────────────────────────────────────────────────────────

  const config = new HeliosConfig(opts.name);

  const tcpIp = config
    .getNetworkConfig()
    .setPort(opts.tcpPort)
    .setPortAutoIncrement(false)
    .getJoin()
    .getTcpIpConfig()
    .setEnabled(true);

  for (const peer of opts.peers) {
    tcpIp.addMember(peer);
  }

  config.getNetworkConfig().getRestApiConfig().setEnabled(true).setPort(opts.restPort).enableAllGroups();
  config.getMonitorConfig().setEnabled(true);

  // Maps — all nodes register the same set so partition ownership is consistent
  config.addMapConfig(new MapConfig(STRESS_MAP_NAME));
  config.addMapConfig(new MapConfig(HOT_MAP_NAME));
  config.addMapConfig(new MapConfig(COLD_MAP_NAME));
  config.addMapConfig(new MapConfig(QUOTE_ROLLUPS_MAP_NAME));

  const ncMapConfig = new MapConfig(NEAR_CACHE_MAP_NAME);
  ncMapConfig.setNearCacheConfig(new NearCacheConfig());
  config.addMapConfig(ncMapConfig);

  const queueConfig = new QueueConfig(STRESS_QUEUE_NAME);
  queueConfig.setBackupCount(1);
  config.addQueueConfig(queueConfig);

  for (const queueName of buildMemberQueueCandidates(opts.name)) {
    const memberQueueConfig = new QueueConfig(queueName);
    memberQueueConfig.setBackupCount(1);
    config.addQueueConfig(memberQueueConfig);
  }

  const topicConfig = new TopicConfig(STRESS_TOPIC_NAME);
  topicConfig.setGlobalOrderingEnabled(true);
  config.addTopicConfig(topicConfig);

  const memberTopicConfig = new TopicConfig(STRESS_MEMBER_TOPIC_NAME);
  memberTopicConfig.setGlobalOrderingEnabled(true);
  config.addTopicConfig(memberTopicConfig);

  // Executor for scatter CPU tasks
  const execConfig = new ExecutorConfig('compute');
  execConfig.setPoolSize(4);
  execConfig.setQueueCapacity(1024);
  config.addExecutorConfig(execConfig);

  // ── Boot Helios ─────────────────────────────────────────────────────────────

  const instance = (await Helios.newInstance(config)) as HeliosInstanceImpl;

  // Register scatter task implementations so workers can execute them
  const executor = instance.getExecutorService('compute');

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

  // Touch maps so they appear in the monitor inventory immediately
  instance.getMap(STRESS_MAP_NAME);
  instance.getMap(HOT_MAP_NAME);
  instance.getMap(COLD_MAP_NAME);
  instance.getMap(NEAR_CACHE_MAP_NAME);
  instance.getMap(QUOTE_ROLLUPS_MAP_NAME);
  instance.getQueue(STRESS_QUEUE_NAME);
  instance.getTopic(STRESS_TOPIC_NAME);
  instance.getTopic(STRESS_MEMBER_TOPIC_NAME);

  let blitzService: BlitzService | null = null;
  if (jobHost) {
    blitzService = await BlitzService.start({
      embedded: {
        port: STRESS_JOB_HOST_NATS_PORT,
      },
    });
    instance.setBlitzService(blitzService);
  }

  // ── Boot NestJS ─────────────────────────────────────────────────────────────

  let app: INestApplicationContext | null = null;

  try {
    app = await NestFactory.createApplicationContext(StressNodeModule.create(instance, blitzService), {
      logger: false,
    });

    if (jobHost) {
      const blitzJobsService = app.get(BinanceBlitzJobsService);
      const job = await blitzJobsService.ensureStarted(BINANCE_MARKET_ROLLUPS_JOB_NAME);
      process.stdout.write(
        `[${opts.name}] blitz job host active nats=nats://127.0.0.1:${STRESS_JOB_HOST_NATS_PORT} subject=${MARKET_TICKS_SUBJECT} job=${job.name}\n`,
      );
    }

    // ── Signal readiness ────────────────────────────────────────────────────────

    process.stdout.write(
      `[${opts.name}] started — tcp=${opts.tcpPort} rest=${opts.restPort} peers=${opts.peers.join(',') || 'none'}\n`,
    );
    process.stdout.write('HELIOS_NODE_READY\n');

    const memberWorkloadsAbort = new AbortController();
    void startMemberLocalTraffic(instance, opts, memberWorkloadsAbort.signal).catch((err: unknown) => {
      if (memberWorkloadsAbort.signal.aborted) {
        return;
      }
      console.error(`[${opts.name}] member-local workload failed:`, err);
    });

    // ── Graceful shutdown ───────────────────────────────────────────────────────

    let shuttingDown = false;

    const shutdown = (): void => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      memberWorkloadsAbort.abort();

      void (async () => {
        try {
          await app?.close();
        } finally {
          instance.shutdown();
          process.exit(0);
        }
      })();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    await app?.close().catch(() => {});
    await blitzService?.shutdown().catch(() => {});
    instance.shutdown();
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error in stress-node:', err);
  process.exit(1);
});
