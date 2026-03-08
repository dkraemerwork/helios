#!/usr/bin/env bun
/**
 * Standalone Helios stress node process.
 *
 * Booted by the stress-test orchestrator via Bun.spawn().
 * Registers scatter worker tasks and stays alive until killed.
 *
 * Usage:
 *   bun run src/stress-node.ts --name stress-node-1 --tcp-port 15701 --rest-port 18081 [--peer host:port]...
 *
 * Prints "HELIOS_NODE_READY" to stdout when ready for the orchestrator.
 */

import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { ExecutorConfig } from "@zenystx/helios-core/config/ExecutorConfig";
import { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import { NearCacheConfig } from "@zenystx/helios-core/config/NearCacheConfig";
import { Helios } from "@zenystx/helios-core/Helios";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { RestEndpointGroup } from "@zenystx/helios-core/rest/RestEndpointGroup";
import { resolve } from "path";

interface NodeOptions {
  name: string;
  tcpPort: number;
  restPort: number;
  peers: string[];
}

function parseArgs(): NodeOptions {
  const args = process.argv.slice(2);
  const opts: NodeOptions = {
    name: "stress-node",
    tcpPort: 15701,
    restPort: 18081,
    peers: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--name":
        opts.name = next ?? opts.name;
        i++;
        break;
      case "--tcp-port":
        opts.tcpPort = parseInt(next ?? "", 10) || opts.tcpPort;
        i++;
        break;
      case "--rest-port":
        opts.restPort = parseInt(next ?? "", 10) || opts.restPort;
        i++;
        break;
      case "--peer":
        if (next) opts.peers.push(next);
        i++;
        break;
    }
  }

  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs();

  const config = new HeliosConfig(opts.name);

  const tcpIp = config.getNetworkConfig()
    .setPort(opts.tcpPort)
    .setPortAutoIncrement(false)
    .getJoin()
    .getTcpIpConfig()
    .setEnabled(true);

  for (const peer of opts.peers) {
    tcpIp.addMember(peer);
  }

  config.getNetworkConfig()
    .getRestApiConfig()
    .setEnabled(true)
    .setPort(opts.restPort)
    .enableAllGroups();

  config.getMonitorConfig().setEnabled(true);

  config.addMapConfig(new MapConfig("stress-map"));

  const ncMapConfig = new MapConfig("near-cache-map");
  ncMapConfig.setNearCacheConfig(new NearCacheConfig());
  config.addMapConfig(ncMapConfig);

  config.addMapConfig(new MapConfig("hot-map"));
  config.addMapConfig(new MapConfig("cold-map"));

  const execConfig = new ExecutorConfig("compute");
  execConfig.setPoolSize(3);
  execConfig.setQueueCapacity(1024);
  config.addExecutorConfig(execConfig);

  const instance = (await Helios.newInstance(config)) as HeliosInstanceImpl;

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

  // Register maps so they show up on the monitoring dashboard.
  // The client sends operations to these maps via remote dispatch;
  // registering them here ensures the dashboard inventory lists them.
  instance.getMap("stress-map");
  instance.getMap("near-cache-map");
  instance.getMap("hot-map");
  instance.getMap("cold-map");

  console.log(`[${opts.name}] started on tcp=${opts.tcpPort}, rest=${opts.restPort}`);
  console.log("HELIOS_NODE_READY");

  const shutdown = () => {
    console.log(`[${opts.name}] shutting down...`);
    instance.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
