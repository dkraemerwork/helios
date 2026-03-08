import { HeliosTestCluster } from "./helpers/HeliosTestCluster";
import { Client } from "hazelcast-client";

const cluster = new HeliosTestCluster("connect-test");
const info = await cluster.startSingle();
console.log("Cluster started on port:", info.addresses[0]);

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
      'hazelcast.client.heartbeat.interval': 3000,
      'hazelcast.client.heartbeat.timeout': 10000,
      'hazelcast.logging.level': 'TRACE',
    },
  });
  console.log("CLIENT CONNECTED!");
  console.log("  Running:", client.getLifecycleService().isRunning());
  console.log("  Members:", client.getCluster().getMembers().length);
  await client.shutdown();
  console.log("Client shut down");
} catch (e: any) {
  console.error("CLIENT ERROR:", e.message);
  console.error("Stack:", e.stack?.split('\n').slice(0, 10).join('\n'));
}

await cluster.shutdown();
process.exit(0);
