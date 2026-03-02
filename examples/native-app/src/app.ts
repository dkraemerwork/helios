#!/usr/bin/env bun
/**
 * Helios Distributed Demo App
 *
 * Starts a single Helios instance with TCP clustering and an HTTP REST server.
 * Run two instances to see distributed replication + near-cache in action:
 *
 *   Terminal 1:  bun run src/app.ts --name node1 --tcp-port 5701 --http-port 3001
 *   Terminal 2:  bun run src/app.ts --name node2 --tcp-port 5702 --http-port 3002 --peer localhost:5701
 *
 * Then use curl:
 *   curl -X PUT http://localhost:3001/map/demo/user1 -d '{"name":"Alice"}'
 *   curl http://localhost:3002/map/demo/user1          # reads from node2 (replicated!)
 *   curl http://localhost:3002/near-cache/demo/stats    # near-cache hit/miss stats
 */
import { Helios } from '../../../src/Helios';
import { HeliosConfig } from '../../../src/config/HeliosConfig';
import { MapConfig } from '../../../src/config/MapConfig';
import { NearCacheConfig } from '../../../src/config/NearCacheConfig';
import { HeliosHttpServer } from './http-server';

// ── CLI argument parsing ────────────────────────────────────────────────

function parseArgs(args: string[]): {
    name: string;
    tcpPort: number;
    httpPort: number;
    peers: string[];
} {
    const result = {
        name: 'helios',
        tcpPort: 5701,
        httpPort: 3001,
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
            case '--http-port':
                result.httpPort = parseInt(next, 10);
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
  --name <name>         Instance name (default: helios)
  --tcp-port <port>     TCP cluster port (default: 5701)
  --http-port <port>    HTTP REST port (default: 3001)
  --peer <host:port>    Connect to peer (repeatable)
  --help                Show this help
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

    // Start Helios instance
    const instance = await Helios.newInstance(config);
    console.log(`[${opts.name}] Helios instance started (TCP: ${opts.tcpPort})`);

    // Start HTTP server
    const httpServer = new HeliosHttpServer({
        instance,
        httpPort: opts.httpPort,
    });
    httpServer.start();
    console.log(`[${opts.name}] HTTP server listening on http://localhost:${opts.httpPort}`);

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
[${opts.name}] Ready! Endpoints:
  PUT    http://localhost:${opts.httpPort}/map/:name/:key        — store a value
  GET    http://localhost:${opts.httpPort}/map/:name/:key        — read a value (shows near-cache source)
  DELETE http://localhost:${opts.httpPort}/map/:name/:key        — remove a value
  GET    http://localhost:${opts.httpPort}/map/:name             — list all entries
  POST   http://localhost:${opts.httpPort}/map/:name/query       — query with predicate (JSON body)
  GET    http://localhost:${opts.httpPort}/map/:name/values?...  — query values (query params)
  GET    http://localhost:${opts.httpPort}/map/:name/keys?...    — query keys (query params)
  GET    http://localhost:${opts.httpPort}/near-cache/:name/stats — near-cache stats
  GET    http://localhost:${opts.httpPort}/health                — health check
  GET    http://localhost:${opts.httpPort}/cluster/info          — cluster info
`);

    // Graceful shutdown
    const shutdown = () => {
        console.log(`\n[${opts.name}] Shutting down...`);
        httpServer.stop();
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
