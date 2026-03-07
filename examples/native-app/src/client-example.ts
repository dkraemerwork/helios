#!/usr/bin/env bun
/**
 * Helios Remote Client Example
 *
 * Demonstrates connecting a separate Bun application to a running Helios
 * cluster over the binary client protocol.
 *
 * Usage:
 *   1. Start a Helios server:   bun run examples/native-app/src/app.ts
 *   2. Run this client:         bun run examples/native-app/src/client-example.ts
 *
 * Environment variables:
 *   HELIOS_CLUSTER_ADDRESS  — server address (default: 127.0.0.1:5701)
 *   HELIOS_CLUSTER_NAME     — cluster name   (default: dev)
 */
import { HeliosClient } from "@zenystx/helios-core/client/HeliosClient";
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";

async function main(): Promise<void> {
    const address = process.env["HELIOS_CLUSTER_ADDRESS"] ?? "127.0.0.1:5701";
    const clusterName = process.env["HELIOS_CLUSTER_NAME"] ?? "dev";

    // ── Configure ────────────────────────────────────────────────────────────
    const config = new ClientConfig();
    config.setClusterName(clusterName);
    config.getNetworkConfig().addAddress(address);

    // ── Connect ──────────────────────────────────────────────────────────────
    console.log(`Connecting to Helios cluster '${clusterName}' at ${address}...`);
    const client = HeliosClient.newHeliosClient(config);
    console.log(`Connected as '${client.getName()}'.`);

    // ── Map operations ───────────────────────────────────────────────────────
    const map = client.getMap<string, string>("demo-map");
    await map.put("greeting", "hello from remote client");
    const value = await map.get("greeting");
    console.log(`Map 'demo-map' -> greeting = ${value}`);

    // ── Queue operations ─────────────────────────────────────────────────────
    const queue = client.getQueue<string>("demo-queue");
    await queue.offer("task-1");
    await queue.offer("task-2");
    const polled = await queue.poll();
    console.log(`Queue 'demo-queue' -> polled = ${polled}`);

    // ── Topic operations ─────────────────────────────────────────────────────
    const topic = client.getTopic<string>("demo-topic");
    topic.addMessageListener((msg) => {
        console.log(`Topic 'demo-topic' received: ${msg.getMessageObject()}`);
    });
    await topic.publish("hello from client");

    // ── Cluster info ─────────────────────────────────────────────────────────
    const cluster = client.getCluster();
    const members = cluster.getMembers();
    console.log(`Cluster has ${members.length} member(s):`);
    for (const member of members) {
        console.log(`  ${member.getAddress().getHost()}:${member.getAddress().getPort()}`);
    }

    // ── Shutdown ─────────────────────────────────────────────────────────────
    client.shutdown();
    console.log("Client shut down.");
}

main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
});
