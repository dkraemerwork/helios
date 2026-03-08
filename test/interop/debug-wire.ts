/**
 * Debug: Run full official client to trace post-auth flow.
 */
import { HeliosTestCluster } from "./helpers/HeliosTestCluster";
import { Client } from "hazelcast-client";

const cluster = new HeliosTestCluster("debug-test");
const info = await cluster.startSingle();
console.log("[debug] Cluster started:", info.addresses[0]);

try {
  const client = await Client.newHazelcastClient({
    clusterName: info.clusterName,
    network: { 
      clusterMembers: info.addresses,
      connectionTimeout: 5000,
    },
    connectionStrategy: {
      connectionRetry: {
        clusterConnectTimeoutMillis: 8000,
      },
    },
    properties: {
      'hazelcast.logging.level': 'TRACE',
    },
  });
  console.log("[debug] CLIENT CONNECTED!");
  console.log("[debug] Running:", client.getLifecycleService().isRunning());
  console.log("[debug] Members:", client.getCluster().getMembers().length);
  await client.shutdown();
  console.log("[debug] Client shut down");
} catch (e: any) {
  console.error("[debug] CLIENT ERROR:", e.message);
}

await cluster.shutdown();
process.exit(0);
