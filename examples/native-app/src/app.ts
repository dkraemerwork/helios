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
import { Helios } from "@zenystx/core/Helios";
import type { HeliosInstanceImpl } from "@zenystx/core/instance/impl/HeliosInstanceImpl";
import { HeliosConfig } from "@zenystx/core/config/HeliosConfig";
import { MapConfig } from "@zenystx/core/config/MapConfig";
import { NearCacheConfig } from "@zenystx/core/config/NearCacheConfig";
import { RestEndpointGroup } from "@zenystx/core/rest/RestEndpointGroup";
import type { Message } from "@zenystx/core/topic/Message";

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
}> {
  return instance
    .getCluster()
    .getMembers()
    .map((member) => ({
      uuid: member.getUuid(),
      address: `${member.getAddress().getHost()}:${member.getAddress().getPort()}`,
      localMember: member.localMember(),
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
    await instance.getTopic(topicName).publish(payload);
  };

  const getMessages = (topicName: string): DemoTopicMessage[] => {
    ensureObserved(topicName);
    return [...(topicMessages.get(topicName) ?? [])];
  };

  const getObservedTopics = (): string[] => Array.from(observedTopics.keys());

  return {
    destroy,
    ensureObserved,
    getMessages,
    getObservedTopics,
    publish,
  };
}

function startControlServer(
  instance: HeliosInstanceImpl,
  nodeName: string,
  port: number,
  topicBridge: ReturnType<typeof createTopicBridge>,
) {
  return Bun.serve({
    port,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

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
    GET  /demo/cluster
    GET  /demo/topics
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
    controlServer.stop(true);
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
