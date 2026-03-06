#!/usr/bin/env bun
/**
 * Helios distributed demo app.
 *
 * Starts one Helios member with:
 * - TCP clustering
 * - the built-in REST server for map/queue operations
 * - a lightweight demo control server for topic publish/inspect endpoints
 *
 * This is intended for local multi-node playgrounds and Docker Compose demos.
 */
import { Helios } from "@zenystx/helios-core/Helios";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import { NearCacheConfig } from "@zenystx/helios-core/config/NearCacheConfig";
import { RestEndpointGroup } from "@zenystx/helios-core/rest/RestEndpointGroup";
import type { Message } from "@zenystx/helios-core/topic/Message";
import {
  renderManagementCenterPage,
  type ManagementCenterPayload,
} from "./managementCenter";

interface AppOptions {
  name: string;
  tcpPort: number;
  restPort: number;
  controlPort: number;
  expectedClusterSize: number | null;
  restGroups: RestEndpointGroup[];
  peers: string[];
  observedTopics: string[];
}

interface DemoTopicMessage {
  topicName: string;
  payload: unknown;
  publishTime: number;
  publishingMemberId: string | null;
  receivedAt: number;
}

interface OverviewSample {
  timestamp: number;
  bytesRead: number;
  bytesWritten: number;
  topicPublishes: number;
  topicReceives: number;
  queueOffers: number;
  queuePolls: number;
  totalKnownObjects: number;
  totalBackupObjects: number;
}

interface MemberDashboardRow {
  uuid: string;
  address: string;
  localMember: boolean;
  version: string;
  isLiteMember: boolean;
  isMaster: boolean;
  primaryPartitions: number;
  backupPartitions: number;
  primaryMaps: number;
  backupMaps: number;
  primaryTopics: number;
  backupTopics: number;
  primaryQueues: number;
  backupQueues: number;
  primaryObjects: number;
  backupObjects: number;
}

const MAX_TOPIC_MESSAGES = 50;
const DEFAULT_REST_GROUPS = [
  RestEndpointGroup.HEALTH_CHECK,
  RestEndpointGroup.CLUSTER_READ,
  RestEndpointGroup.DATA,
] as RestEndpointGroup[];

function parseIntOrDefault(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseOptionalInt(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseRestGroups(value: string | undefined): RestEndpointGroup[] {
  const values = parseList(value);
  if (values.length === 0) {
    return [...DEFAULT_REST_GROUPS];
  }
  return values.map((entry) => entry as RestEndpointGroup);
}

function clusterMembers(instance: HeliosInstanceImpl): Array<{
  uuid: string;
  address: string;
  localMember: boolean;
  version: string;
  isLiteMember: boolean;
}> {
  return instance
    .getCluster()
    .getMembers()
    .map((member) => ({
      uuid: member.getUuid(),
      address: `${member.getAddress().getHost()}:${member.getAddress().getPort()}`,
      localMember: member.localMember() || member.getUuid() === instance.getName(),
      version: member.getVersion().toString(),
      isLiteMember: member.isLiteMember(),
    }));
}

function parseArgs(args: string[]): AppOptions {
  const result: AppOptions = {
    name: process.env["HELIOS_NAME"] ?? "helios",
    tcpPort: parseIntOrDefault(process.env["HELIOS_TCP_PORT"], 5701),
    restPort: parseIntOrDefault(process.env["HELIOS_REST_PORT"], 8080),
    controlPort: parseIntOrDefault(process.env["HELIOS_CONTROL_PORT"], 9090),
    expectedClusterSize: parseOptionalInt(
      process.env["HELIOS_EXPECTED_CLUSTER_SIZE"],
    ),
    restGroups: parseRestGroups(process.env["HELIOS_REST_GROUPS"]),
    peers: parseList(process.env["HELIOS_PEERS"]),
    observedTopics: parseList(process.env["HELIOS_OBSERVED_TOPICS"]),
  };

  if (result.observedTopics.length === 0) {
    result.observedTopics = ["demo-events"];
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--name":
        result.name = next;
        index++;
        break;
      case "--tcp-port":
        result.tcpPort = parseIntOrDefault(next, result.tcpPort);
        index++;
        break;
      case "--rest-port":
        result.restPort = parseIntOrDefault(next, result.restPort);
        index++;
        break;
      case "--control-port":
        result.controlPort = parseIntOrDefault(next, result.controlPort);
        index++;
        break;
      case "--expected-cluster-size":
        result.expectedClusterSize = parseOptionalInt(next);
        index++;
        break;
      case "--rest-groups":
        result.restGroups = parseRestGroups(next);
        index++;
        break;
      case "--peer":
        result.peers.push(next);
        index++;
        break;
      case "--observed-topic":
        result.observedTopics.push(next);
        index++;
        break;
      case "--help":
        console.log(`
Helios distributed demo app

Usage:
  bun run src/app.ts [options]

Options:
  --name <name>                    Instance name
  --tcp-port <port>                TCP cluster port
  --rest-port <port>               Built-in Helios REST port
  --control-port <port>            Demo control server port
  --expected-cluster-size <n>      Wait until this many members are visible
  --rest-groups <g1,g2,...>        Enabled REST endpoint groups
  --peer <host:port>               Cluster seed member (repeatable)
  --observed-topic <name>          Topic to subscribe to on startup (repeatable)
  --help                           Show this help

Environment variables:
  HELIOS_NAME
  HELIOS_TCP_PORT
  HELIOS_REST_PORT
  HELIOS_CONTROL_PORT
  HELIOS_EXPECTED_CLUSTER_SIZE
  HELIOS_REST_GROUPS
  HELIOS_PEERS                     Comma-separated seed members
  HELIOS_OBSERVED_TOPICS           Comma-separated startup topic listeners
`);
        process.exit(0);
    }
  }

  result.observedTopics = Array.from(new Set(result.observedTopics));
  return result;
}

function createJsonResponse(payload: unknown, init?: ResponseInit): Response {
  return Response.json(payload, init);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const body = await request.text();
  if (body.trim() === "") {
    return null;
  }
  return JSON.parse(body);
}

function createTopicBridge(instance: HeliosInstanceImpl, nodeName: string) {
  const observedTopics = new Map<string, string>();
  const topicMessages = new Map<string, DemoTopicMessage[]>();
  let publishCount = 0;

  const appendMessage = (
    topicName: string,
    message: Message<unknown>,
  ): void => {
    const messages = topicMessages.get(topicName) ?? [];
    messages.push({
      topicName,
      payload: message.getMessageObject(),
      publishTime: message.getPublishTime(),
      publishingMemberId: message.getPublishingMemberId(),
      receivedAt: Date.now(),
    });
    if (messages.length > MAX_TOPIC_MESSAGES) {
      messages.splice(0, messages.length - MAX_TOPIC_MESSAGES);
    }
    topicMessages.set(topicName, messages);
    console.log(
      `[${nodeName}] topic '${topicName}' received ${JSON.stringify(message.getMessageObject())}`,
    );
  };

  const ensureObserved = (topicName: string): void => {
    if (observedTopics.has(topicName)) {
      return;
    }
    const registrationId = instance
      .getTopic<unknown>(topicName)
      .addMessageListener((message) => appendMessage(topicName, message));
    observedTopics.set(topicName, registrationId);
    if (!topicMessages.has(topicName)) {
      topicMessages.set(topicName, []);
    }
  };

  const destroy = (): void => {
    for (const [topicName, registrationId] of Array.from(
      observedTopics.entries(),
    )) {
      instance.getTopic(topicName).removeMessageListener(registrationId);
    }
    observedTopics.clear();
  };

  const publish = async (
    topicName: string,
    payload: unknown,
  ): Promise<void> => {
    ensureObserved(topicName);
    publishCount++;
    await instance.getTopic(topicName).publish(payload);
  };

  const getMessages = (topicName: string): DemoTopicMessage[] => {
    ensureObserved(topicName);
    return [...(topicMessages.get(topicName) ?? [])];
  };

  const getObservedTopics = (): string[] => Array.from(observedTopics.keys());

  const getTopicSummaries = (): Array<{
    topicName: string;
    messageCount: number;
    lastMessage: DemoTopicMessage | null;
  }> =>
    getObservedTopics().map((topicName) => {
      const messages = topicMessages.get(topicName) ?? [];
      return {
        topicName,
        messageCount: messages.length,
        lastMessage: messages.length > 0 ? messages[messages.length - 1] : null,
      };
    });

  const getRecentMessages = (limit: number): DemoTopicMessage[] =>
    Array.from(topicMessages.values())
      .flatMap((messages) => messages)
      .sort((left, right) => right.receivedAt - left.receivedAt)
      .slice(0, limit);

  const getTotalMessageCount = (): number =>
    Array.from(topicMessages.values()).reduce(
      (sum, messages) => sum + messages.length,
      0,
    );

  const getPublishCount = (): number => publishCount;

  return {
    destroy,
    ensureObserved,
    getMessages,
    getObservedTopics,
    getPublishCount,
    getRecentMessages,
    getTopicSummaries,
    getTotalMessageCount,
    publish,
  };
}

function createManagementCenterModel(
  instance: HeliosInstanceImpl,
  nodeName: string,
  restPort: number,
  controlPort: number,
  topicBridge: ReturnType<typeof createTopicBridge>,
) {
  const samples: OverviewSample[] = [];

  const pruneSamples = (): void => {
    if (samples.length > 24) {
      samples.splice(0, samples.length - 24);
    }
  };

  const getPayload = async (): Promise<ManagementCenterPayload> => {
    const inventory = instance.getKnownDistributedObjectNames();
    const transport = instance.getTransportStats();
    const members = clusterMembers(instance);
    const masterAddress = instance.getClusterMasterAddress();
    const memberRows = new Map<string, MemberDashboardRow>(
      members.map((member) => [
        member.uuid,
        {
          uuid: member.uuid,
          address: member.address,
          localMember: member.localMember,
          version: member.version,
          isLiteMember: member.isLiteMember,
          isMaster: member.address === masterAddress,
          primaryPartitions: 0,
          backupPartitions: 0,
          primaryMaps: 0,
          backupMaps: 0,
          primaryTopics: 0,
          backupTopics: 0,
          primaryQueues: 0,
          backupQueues: 0,
          primaryObjects: 0,
          backupObjects: 0,
        },
      ]),
    );

    const partitionCount = instance.getPartitionCount();
    for (let partitionId = 0; partitionId < partitionCount; partitionId++) {
      const ownerId = instance.getPartitionOwnerId(partitionId);
      if (ownerId !== null) {
        const owner = memberRows.get(ownerId);
        if (owner !== undefined) {
          owner.primaryPartitions++;
        }
      }

      for (const backupId of instance.getPartitionBackupIds(partitionId)) {
        const backup = memberRows.get(backupId);
        if (backup !== undefined) {
          backup.backupPartitions++;
        }
      }
    }

    const assignDistributedObjects = (
      names: string[],
      primaryKey: "primaryMaps" | "primaryTopics" | "primaryQueues",
      backupKey: "backupMaps" | "backupTopics" | "backupQueues",
    ): void => {
      for (const name of names) {
        const partitionId = instance.getPartitionIdForName(name);
        const ownerId = instance.getPartitionOwnerId(partitionId);
        if (ownerId !== null) {
          const owner = memberRows.get(ownerId);
          if (owner !== undefined) {
            owner[primaryKey]++;
          }
        }

        for (const backupId of instance.getPartitionBackupIds(partitionId)) {
          const backup = memberRows.get(backupId);
          if (backup !== undefined) {
            backup[backupKey]++;
          }
        }
      }
    };

    assignDistributedObjects(inventory.maps, "primaryMaps", "backupMaps");
    assignDistributedObjects(inventory.topics, "primaryTopics", "backupTopics");
    assignDistributedObjects(inventory.queues, "primaryQueues", "backupQueues");

    let topicPublishes = 0;
    let topicReceives = 0;
    const observedTopics = topicBridge.getObservedTopics().map((topicName) => {
      const messages = topicBridge.getMessages(topicName);
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
      const stats = instance.getTopic(topicName).getLocalTopicStats();
      topicPublishes += stats.getPublishOperationCount();
      topicReceives += stats.getReceiveOperationCount();

      return {
        topicName,
        messageCount: messages.length,
        publishCount: stats.getPublishOperationCount(),
        receiveCount: stats.getReceiveOperationCount(),
        lastMessage,
      };
    });

    let queueOffers = 0;
    let queuePolls = 0;
    let totalKnownObjects = 0;
    for (const queueName of inventory.queues) {
      const queue = instance.getQueue(queueName);
      const queueStats = queue.getLocalQueueStats();
      const queueSize = await queue.size();
      const partitionId = instance.getPartitionIdForName(queueName);
      const ownerId = instance.getPartitionOwnerId(partitionId);
      const backupIds = instance.getPartitionBackupIds(partitionId);

      queueOffers += queueStats.getOfferOperationCount();
      queuePolls += queueStats.getPollOperationCount();
      totalKnownObjects += queueSize;

      if (ownerId !== null) {
        const owner = memberRows.get(ownerId);
        if (owner !== undefined) {
          owner.primaryObjects += queueSize;
        }
      }
      for (const backupId of backupIds) {
        const backup = memberRows.get(backupId);
        if (backup !== undefined) {
          backup.backupObjects += queueSize;
        }
      }
    }

    const now = Date.now();
    const totalBackupObjects = Array.from(memberRows.values()).reduce(
      (sum, row) => sum + row.backupObjects,
      0,
    );

    samples.push({
      timestamp: now,
      bytesRead: transport.bytesRead,
      bytesWritten: transport.bytesWritten,
      topicPublishes,
      topicReceives,
      queueOffers,
      queuePolls,
      totalKnownObjects,
      totalBackupObjects,
    });
    pruneSamples();

    const localRow = Array.from(memberRows.values()).find((row) => row.localMember) ??
      Array.from(memberRows.values())[0];

    return {
      nodeName,
      clusterId: instance.getClusterId() ?? nodeName,
      restBaseUrl: `http://localhost:${restPort}`,
      controlBaseUrl: `http://localhost:${controlPort}`,
      nodeState: String(instance.getNodeState()),
      clusterState: instance.getClusterState(),
      clusterSafe: instance.isClusterSafe(),
      memberVersion: instance.getMemberVersion(),
      masterAddress,
      topology: {
        memberCount: members.length,
        partitionCount,
        knownMaps: inventory.maps.length,
        knownTopics: inventory.topics.length,
        knownQueues: inventory.queues.length,
        openChannels: transport.openChannels,
        peerCount: transport.peerCount,
        localPrimaryPartitions: localRow?.primaryPartitions ?? 0,
        localBackupPartitions: localRow?.backupPartitions ?? 0,
      },
      metrics: {
        bytesRead: transport.bytesRead,
        bytesWritten: transport.bytesWritten,
        topicPublishes,
        topicReceives,
        queueOffers,
        queuePolls,
        totalKnownObjects,
        totalBackupObjects,
      },
      members: Array.from(memberRows.values()).sort((left, right) => {
        if (left.isMaster !== right.isMaster) {
          return left.isMaster ? -1 : 1;
        }
        if (left.localMember !== right.localMember) {
          return left.localMember ? -1 : 1;
        }
        return left.address.localeCompare(right.address);
      }),
      objectInventory: inventory,
      observedTopics,
      recentMessages: topicBridge.getRecentMessages(10),
      samples: [...samples],
    };
  };

  const destroy = (): void => {
    samples.length = 0;
  };

  return {
    destroy,
    getPayload,
  };
}

function startControlServer(
  instance: HeliosInstanceImpl,
  nodeName: string,
  restPort: number,
  port: number,
  topicBridge: ReturnType<typeof createTopicBridge>,
) {
  const managementCenter = createManagementCenterModel(
    instance,
    nodeName,
    restPort,
    port,
    topicBridge,
  );

  const server = Bun.serve({
    port,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "GET" && (path === "/" || path === "/management")) {
        return new Response(renderManagementCenterPage(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (request.method === "GET" && path === "/demo/management-center/data") {
        return createJsonResponse(await managementCenter.getPayload());
      }

      if (request.method === "GET" && path === "/demo") {
        return createJsonResponse({
          nodeName,
          tcpPeerCount: instance.getTcpPeerCount(),
          clusterMembers: clusterMembers(instance),
          observedTopics: topicBridge.getObservedTopics(),
        });
      }

      if (request.method === "GET" && path === "/demo/cluster") {
        return createJsonResponse({
          nodeName,
          tcpPeerCount: instance.getTcpPeerCount(),
          clusterMembers: clusterMembers(instance),
        });
      }

      if (request.method === "GET" && path === "/demo/topics") {
        return createJsonResponse({
          observedTopics: topicBridge.getObservedTopics().map((topicName) => ({
            topicName,
            messageCount: topicBridge.getMessages(topicName).length,
          })),
        });
      }

      const publishMatch = path.match(/^\/demo\/topics\/([^/]+)\/publish$/);
      if (request.method === "POST" && publishMatch !== null) {
        const topicName = decodeURIComponent(publishMatch[1]);
        const payload = await readJsonBody(request);
        await topicBridge.publish(topicName, payload);
        return createJsonResponse({ ok: true, topicName, payload });
      }

      const observeMatch = path.match(/^\/demo\/topics\/([^/]+)\/observe$/);
      if (request.method === "POST" && observeMatch !== null) {
        const topicName = decodeURIComponent(observeMatch[1]);
        topicBridge.ensureObserved(topicName);
        return createJsonResponse({ ok: true, topicName });
      }

      const messagesMatch = path.match(/^\/demo\/topics\/([^/]+)\/messages$/);
      if (request.method === "GET" && messagesMatch !== null) {
        const topicName = decodeURIComponent(messagesMatch[1]);
        return createJsonResponse({
          topicName,
          messages: topicBridge.getMessages(topicName),
        });
      }

      return createJsonResponse({ error: "Not Found" }, { status: 404 });
    },
    error(error) {
      return createJsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    },
  });

  return {
    destroy: (): void => {
      managementCenter.destroy();
      server.stop(true);
    },
  };
}

async function waitForExpectedClusterSize(
  instance: HeliosInstanceImpl,
  expectedClusterSize: number,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (instance.getCluster().getMembers().length >= expectedClusterSize) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for cluster size ${expectedClusterSize}; saw ${instance.getCluster().getMembers().length}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const config = new HeliosConfig(options.name);
  config
    .getNetworkConfig()
    .setPort(options.tcpPort)
    .getJoin()
    .getTcpIpConfig()
    .setEnabled(true);

  config
    .getNetworkConfig()
    .getRestApiConfig()
    .setEnabled(true)
    .setPort(options.restPort)
    .disableAllGroups()
    .enableGroups(...options.restGroups);

  for (const peer of options.peers) {
    config.getNetworkConfig().getJoin().getTcpIpConfig().addMember(peer);
  }

  const demoMapConfig = new MapConfig("demo");
  demoMapConfig.setNearCacheConfig(new NearCacheConfig());
  config.addMapConfig(demoMapConfig);

  const instance = (await Helios.newInstance(config)) as HeliosInstanceImpl;
  const restPort = instance.getRestServer().getBoundPort();
  const topicBridge = createTopicBridge(instance, options.name);
  for (const topicName of options.observedTopics) {
    topicBridge.ensureObserved(topicName);
  }
  const controlServer = startControlServer(
    instance,
    options.name,
    restPort,
    options.controlPort,
    topicBridge,
  );

  console.log(
    `[${options.name}] started (tcp=${options.tcpPort}, rest=${restPort}, control=${options.controlPort})`,
  );
  if (options.peers.length > 0) {
    console.log(`[${options.name}] seed members: ${options.peers.join(", ")}`);
  }

  if (options.expectedClusterSize !== null) {
    console.log(
      `[${options.name}] waiting for cluster size ${options.expectedClusterSize}...`,
    );
    await waitForExpectedClusterSize(instance, options.expectedClusterSize);
  }

  console.log(
    `[${options.name}] cluster members: ${clusterMembers(instance)
      .map((member) => member.address)
      .join(", ")}`,
  );
  console.log(`
[${options.name}] ready
  Built-in REST: http://localhost:${restPort}/hazelcast/rest
    GET  /maps/{name}/{key}
    POST /maps/{name}/{key}
    GET  /queues/{name}/size
    POST /queues/{name}
    GET  /queues/{name}/{timeout}
  Demo control: http://localhost:${options.controlPort}/demo
  Management UI: http://localhost:${options.controlPort}/management
    GET  /demo/cluster
    GET  /demo/topics
    GET  /demo/management-center/data
    POST /demo/topics/{name}/publish
    GET  /demo/topics/{name}/messages
`);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`\n[${options.name}] shutting down...`);
    controlServer.destroy();
    topicBridge.destroy();
    instance.shutdown();
    console.log(`[${options.name}] goodbye.`);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
