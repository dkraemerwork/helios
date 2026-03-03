#!/usr/bin/env bun
/**
 * Helios Distributed Demo App
 *
 * Starts a single Helios instance with TCP clustering and the built-in
 * HeliosRestServer for `/hazelcast/*` endpoints.
 *
 * Run two instances to see distributed replication + near-cache in action:
 *
 *   Terminal 1:  bun run src/app.ts --name node1 --tcp-port 5701 --rest-port 8081
 *   Terminal 2:  bun run src/app.ts --name node2 --tcp-port 5702 --rest-port 8082 --peer localhost:5701
 *
 * Then use curl:
 *   curl -X POST http://localhost:8081/hazelcast/rest/maps/demo/user1 \
 *        -H 'Content-Type: application/json' -d '{"name":"Alice"}'
 *   curl http://localhost:8082/hazelcast/rest/maps/demo/user1      # reads from node2
 *   curl http://localhost:8081/hazelcast/health/ready               # K8s readiness probe
 *   curl http://localhost:8081/hazelcast/rest/cluster               # cluster info
 */
import { Helios } from '@helios/Helios';
import { HeliosConfig } from '@helios/config/HeliosConfig';
import { MapConfig } from '@helios/config/MapConfig';
import { NearCacheConfig } from '@helios/config/NearCacheConfig';
import { RestEndpointGroup } from '@helios/rest/RestEndpointGroup';

// ── CLI argument parsing ────────────────────────────────────────────────

function parseArgs(args: string[]): {
    name: string;
    tcpPort: number;
    restPort: number;
    restGroups: RestEndpointGroup[];
    peers: string[];
} {
    const result = {
        name: 'helios',
        tcpPort: 5701,
        restPort: 8080,
        restGroups: [
            RestEndpointGroup.HEALTH_CHECK,
            RestEndpointGroup.CLUSTER_READ,
            RestEndpointGroup.DATA,
        ] as RestEndpointGroup[],
        peers: [] as string[],
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        switch (arg) {
            case '--name':
                result.name = next;
                i++;
                break;
            case '--tcp-port':
                result.tcpPort = parseInt(next, 10);
                i++;
                break;
            case '--rest-port':
                result.restPort = parseInt(next, 10);
                i++;
                break;
            case '--rest-groups':
                result.restGroups = next.split(',').map((g) => g.trim() as RestEndpointGroup);
                i++;
                break;
            case '--peer':
                result.peers.push(next);
                i++;
                break;
            case '--help':
                console.log(`
Helios Distributed Demo App

Usage:
  bun run src/app.ts [options]

Options:
  --name <name>              Instance name (default: helios)
  --tcp-port <port>          TCP cluster port (default: 5701)
  --rest-port <port>         REST API port (default: 8080)
  --rest-groups <g1,g2,...>  Comma-separated REST groups to enable
                             (default: HEALTH_CHECK,CLUSTER_READ,DATA)
  --peer <host:port>         Connect to peer (repeatable)
  --help                     Show this help
`);
                process.exit(0);
        }
    }

    return result;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    // Build Helios config
    const config = new HeliosConfig(opts.name);
    config.getNetworkConfig()
        .setPort(opts.tcpPort)
        .getJoin()
        .getTcpIpConfig()
        .setEnabled(true);

    // Enable built-in REST server
    config.getNetworkConfig()
        .getRestApiConfig()
        .setEnabled(true)
        .setPort(opts.restPort)
        .disableAllGroups()
        .enableGroups(...opts.restGroups);

    // Add peers
    for (const peer of opts.peers) {
        config.getNetworkConfig()
            .getJoin()
            .getTcpIpConfig()
            .addMember(peer);
    }

    // Configure "demo" map with near-cache
    const demoMapConfig = new MapConfig('demo');
    demoMapConfig.setNearCacheConfig(new NearCacheConfig());
    config.addMapConfig(demoMapConfig);

    // Start Helios instance (REST server starts automatically)
    const instance = await Helios.newInstance(config);
    const restPort = instance.getRestServer().getBoundPort();
    console.log(`[${opts.name}] Helios instance started (TCP: ${opts.tcpPort}, REST: ${restPort})`);

    // Wait for peer connections
    if (opts.peers.length > 0) {
        console.log(`[${opts.name}] Connecting to peers: ${opts.peers.join(', ')}...`);
        const deadline = Date.now() + 5000;
        while (instance.getTcpPeerCount() < 1 && Date.now() < deadline) {
            await Bun.sleep(50);
        }
        if (instance.getTcpPeerCount() > 0) {
            console.log(`[${opts.name}] Connected to ${instance.getTcpPeerCount()} peer(s)`);
        } else {
            console.log(`[${opts.name}] Warning: no peers connected yet (they may join later)`);
        }
    }

    console.log(`
[${opts.name}] Ready! REST endpoints on http://localhost:${restPort}:
  GET    /hazelcast/health/ready                             — K8s readiness probe
  GET    /hazelcast/health                                   — full health JSON
  GET    /hazelcast/rest/cluster                             — cluster info
  GET    /hazelcast/rest/instance                            — instance name
  GET    /hazelcast/rest/log-level                           — current log level
  POST   /hazelcast/rest/maps/{name}/{key}   (JSON body)    — store a value
  GET    /hazelcast/rest/maps/{name}/{key}                   — read a value
  DELETE /hazelcast/rest/maps/{name}/{key}                   — remove a value
  GET    /hazelcast/rest/queues/{name}/size                  — queue size
  POST   /hazelcast/rest/queues/{name}       (JSON body)    — offer to queue
  GET    /hazelcast/rest/queues/{name}/{timeout}             — poll from queue
`);

    // Graceful shutdown
    const shutdown = () => {
        console.log(`\n[${opts.name}] Shutting down...`);
        instance.shutdown();
        console.log(`[${opts.name}] Goodbye.`);
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
