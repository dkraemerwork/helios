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
import { HeliosModule } from '@zenystx/helios-nestjs';
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { DynamicModule } from '@nestjs/common';
import { resolve } from 'path';
import 'reflect-metadata';

// ── CLI ───────────────────────────────────────────────────────────────────────

interface NodeOptions {
  name: string;
  tcpPort: number;
  restPort: number;
  peers: string[];
}

function parseArgs(): NodeOptions {
  const args = process.argv.slice(2);
  const opts: NodeOptions = {
    name: 'stress-node',
    tcpPort: 15701,
    restPort: 18081,
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
  static create(instance: HeliosInstanceImpl): DynamicModule {
    return {
      module: StressNodeModule,
      imports: [HeliosModule.forRoot(instance)],
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  const tasksDir = resolve(import.meta.dirname, 'tasks');

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
  config.addMapConfig(new MapConfig('stress-map'));
  config.addMapConfig(new MapConfig('hot-map'));
  config.addMapConfig(new MapConfig('cold-map'));

  const ncMapConfig = new MapConfig('near-cache-map');
  ncMapConfig.setNearCacheConfig(new NearCacheConfig());
  config.addMapConfig(ncMapConfig);

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
  instance.getMap('stress-map');
  instance.getMap('hot-map');
  instance.getMap('cold-map');
  instance.getMap('near-cache-map');

  // ── Boot NestJS ─────────────────────────────────────────────────────────────

  await NestFactory.createApplicationContext(StressNodeModule.create(instance), { logger: false });

  // ── Signal readiness ────────────────────────────────────────────────────────

  process.stdout.write(
    `[${opts.name}] started — tcp=${opts.tcpPort} rest=${opts.restPort} peers=${opts.peers.join(',') || 'none'}\n`,
  );
  process.stdout.write('HELIOS_NODE_READY\n');

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  const shutdown = (): void => {
    instance.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('Fatal error in stress-node:', err);
  process.exit(1);
});
