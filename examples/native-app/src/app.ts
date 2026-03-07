#!/usr/bin/env bun
/**
 * Helios distributed demo app with Blitz stream processing.
 *
 * Starts one Helios member with:
 * - TCP clustering (3-node Helios cluster)
 * - Blitz NATS node (forms a 3-node NATS cluster for stream processing)
 * - Binance WebSocket quote ingestion → NATS subject `quotes.binance`
 * - Control endpoints to start/stop printing quote streams on each node
 * - the built-in REST server for map/queue operations
 * - a lightweight demo control server for topic publish/inspect endpoints
 *
 * Failover: kill any Docker container and the remaining nodes continue
 * receiving quotes via the NATS cluster. If the ingesting node dies,
 * another node automatically takes over WebSocket ingestion.
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
  BlitzService,
  clusterNode,
  type ClusterNodeNatsConfig,
} from "@zenystx/helios-blitz";
import type { NatsServerManager } from "@zenystx/helios-blitz/server/NatsServerManager";
import {
  renderManagementCenterPage,
  type ManagementCenterPayload,
} from "./managementCenter";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface AppOptions {
  name: string;
  tcpPort: number;
  restPort: number;
  controlPort: number;
  expectedClusterSize: number | null;
  restGroups: RestEndpointGroup[];
  peers: string[];
  observedTopics: string[];
  /** NATS client port for this node's embedded nats-server. */
  natsPort: number;
  /** NATS cluster routing port. */
  natsClusterPort: number;
  /** NATS route URLs to other cluster nodes (e.g. nats://node2:6222). */
  natsRoutes: string[];
  /** Binance symbols to subscribe to (e.g. btcusdt,ethusdt). */
  binanceSymbols: string[];
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

/** A single Binance mini-ticker quote received from the WebSocket. */
interface BinanceQuote {
  symbol: string;
  price: string;
  open: string;
  high: string;
  low: string;
  volume: string;
  quoteVolume: string;
  eventTime: number;
  receivedAt: number;
}

const MAX_TOPIC_MESSAGES = 50;
const NATS_QUOTE_SUBJECT = "quotes.binance";
const MAX_RECENT_QUOTES = 100;

const DEFAULT_REST_GROUPS = [
  RestEndpointGroup.HEALTH_CHECK,
  RestEndpointGroup.CLUSTER_READ,
  RestEndpointGroup.DATA,
] as RestEndpointGroup[];

/* ------------------------------------------------------------------ */
/*  Parse helpers                                                     */
/* ------------------------------------------------------------------ */

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
    natsPort: parseIntOrDefault(process.env["HELIOS_NATS_PORT"], 4222),
    natsClusterPort: parseIntOrDefault(process.env["HELIOS_NATS_CLUSTER_PORT"], 6222),
    natsRoutes: parseList(process.env["HELIOS_NATS_ROUTES"]),
    binanceSymbols: parseList(process.env["HELIOS_BINANCE_SYMBOLS"]),
  };

  if (result.observedTopics.length === 0) {
    result.observedTopics = ["demo-events"];
  }
  if (result.binanceSymbols.length === 0) {
    result.binanceSymbols = ["btcusdt", "ethusdt"];
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
      case "--nats-port":
        result.natsPort = parseIntOrDefault(next, result.natsPort);
        index++;
        break;
      case "--nats-cluster-port":
        result.natsClusterPort = parseIntOrDefault(next, result.natsClusterPort);
        index++;
        break;
      case "--nats-route":
        result.natsRoutes.push(next);
        index++;
        break;
      case "--binance-symbol":
        result.binanceSymbols.push(next);
        index++;
        break;
      case "--help":
        console.log(`
Helios distributed demo app (with Blitz stream processing)

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
  --nats-port <port>               NATS client port (default: 4222)
  --nats-cluster-port <port>       NATS cluster routing port (default: 6222)
  --nats-route <url>               NATS cluster route URL (repeatable)
  --binance-symbol <symbol>        Binance symbol to stream (repeatable, default: btcusdt,ethusdt)
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
  HELIOS_NATS_PORT                 NATS client port
  HELIOS_NATS_CLUSTER_PORT         NATS cluster routing port
  HELIOS_NATS_ROUTES               Comma-separated NATS cluster route URLs
  HELIOS_BINANCE_SYMBOLS           Comma-separated Binance symbols (e.g. btcusdt,ethusdt)
`);
        process.exit(0);
    }
  }

  result.observedTopics = Array.from(new Set(result.observedTopics));
  result.binanceSymbols = Array.from(new Set(result.binanceSymbols));
  return result;
}

/* ------------------------------------------------------------------ */
/*  JSON helpers                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Binance WebSocket quote ingestion                                 */
/* ------------------------------------------------------------------ */

/**
 * Manages a Binance WebSocket connection that ingests mini-ticker quotes
 * and publishes them onto a NATS subject for cluster-wide distribution.
 *
 * Only one node in the cluster should be the active ingestor at a time.
 * Failover is handled via a simple leader-election: the node that holds
 * the NATS KV lock "quote-ingestor" is the active one.
 */
function createBinanceIngestor(
  blitz: BlitzService,
  nodeName: string,
  symbols: string[],
) {
  let ws: WebSocket | null = null;
  let active = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let totalIngested = 0;
  const encoder = new TextEncoder();

  const buildWsUrl = (): string => {
    const streams = symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join("/");
    return `wss://stream.binance.com:9443/ws/${streams}`;
  };

  const start = (): void => {
    if (active) return;
    active = true;
    connectWs();
    console.log(`[${nodeName}] Binance ingestor STARTED for ${symbols.join(", ")}`);
  };

  const connectWs = (): void => {
    if (!active) return;

    const url = buildWsUrl();
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      console.log(`[${nodeName}] Binance WebSocket connected`);
    });

    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (raw === "") return;

      try {
        const data = JSON.parse(raw);
        // Binance miniTicker format: { e: '24hrMiniTicker', s: 'BTCUSDT', c: '...', ... }
        if (data.e === "24hrMiniTicker") {
          const quote: BinanceQuote = {
            symbol: data.s,
            price: data.c,
            open: data.o,
            high: data.h,
            low: data.l,
            volume: data.v,
            quoteVolume: data.q,
            eventTime: data.E,
            receivedAt: Date.now(),
          };
          // Publish to NATS for cluster-wide distribution
          blitz.nc.publish(NATS_QUOTE_SUBJECT, encoder.encode(JSON.stringify(quote)));
          totalIngested++;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      console.log(`[${nodeName}] Binance WebSocket closed`);
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      console.log(`[${nodeName}] Binance WebSocket error`);
      scheduleReconnect();
    });
  };

  const scheduleReconnect = (): void => {
    if (!active) return;
    if (reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWs();
    }, 3000);
  };

  const stop = (): void => {
    if (!active) return;
    active = false;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
    ws = null;
    console.log(`[${nodeName}] Binance ingestor STOPPED`);
  };

  const getStatus = (): { active: boolean; totalIngested: number; symbols: string[] } => ({
    active,
    totalIngested,
    symbols,
  });

  return { start, stop, getStatus };
}

/* ------------------------------------------------------------------ */
/*  Quote stream subscriber (per-node)                                */
/* ------------------------------------------------------------------ */

/**
 * Subscribes to NATS quote subject and allows start/stop of console printing.
 * Every node can independently control whether it prints quotes.
 */
function createQuoteSubscriber(
  blitz: BlitzService,
  nodeName: string,
) {
  let printing = false;
  let subscribed = false;
  const recentQuotes: BinanceQuote[] = [];
  let totalReceived = 0;
  const decoder = new TextDecoder();

  const ensureSubscribed = (): void => {
    if (subscribed) return;
    subscribed = true;

    const sub = blitz.nc.subscribe(NATS_QUOTE_SUBJECT);
    (async () => {
      for await (const msg of sub) {
        try {
          const quote = JSON.parse(decoder.decode(msg.data)) as BinanceQuote;
          totalReceived++;
          recentQuotes.push(quote);
          if (recentQuotes.length > MAX_RECENT_QUOTES) {
            recentQuotes.shift();
          }

          if (printing) {
            const direction = Number.parseFloat(quote.price) >= Number.parseFloat(quote.open) ? "▲" : "▼";
            console.log(
              `[${nodeName}] ${direction} ${quote.symbol} $${quote.price} | vol: ${quote.volume} | ${new Date(quote.eventTime).toISOString()}`,
            );
          }
        } catch {
          // Ignore decode errors
        }
      }
    })().catch(() => { /* subscription closed */ });
  };

  const startPrinting = (): void => {
    ensureSubscribed();
    printing = true;
    console.log(`[${nodeName}] Quote printing STARTED`);
  };

  const stopPrinting = (): void => {
    printing = false;
    console.log(`[${nodeName}] Quote printing STOPPED`);
  };

  const getStatus = (): {
    printing: boolean;
    subscribed: boolean;
    totalReceived: number;
    recentQuotes: BinanceQuote[];
  } => ({
    printing,
    subscribed,
    totalReceived,
    recentQuotes: recentQuotes.slice(-10),
  });

  return { ensureSubscribed, startPrinting, stopPrinting, getStatus };
}

/* ------------------------------------------------------------------ */
/*  Topic bridge (existing functionality)                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Management center model                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Control server (HTTP)                                             */
/* ------------------------------------------------------------------ */

function startControlServer(
  instance: HeliosInstanceImpl,
  nodeName: string,
  restPort: number,
  port: number,
  topicBridge: ReturnType<typeof createTopicBridge>,
  ingestor: ReturnType<typeof createBinanceIngestor>,
  subscriber: ReturnType<typeof createQuoteSubscriber>,
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

      /* ---------- Management center ---------- */

      if (request.method === "GET" && (path === "/" || path === "/management")) {
        return new Response(renderManagementCenterPage(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (request.method === "GET" && path === "/demo/management-center/data") {
        return createJsonResponse(await managementCenter.getPayload());
      }

      /* ---------- Cluster info ---------- */

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

      /* ---------- Topic endpoints ---------- */

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

      /* ---------- Blitz / Quotes endpoints ---------- */

      // GET /blitz/quotes/status — status of ingestor + subscriber on this node
      if (request.method === "GET" && path === "/blitz/quotes/status") {
        return createJsonResponse({
          nodeName,
          ingestor: ingestor.getStatus(),
          subscriber: subscriber.getStatus(),
        });
      }

      // POST /blitz/quotes/ingest/start — start Binance WebSocket ingestion on this node
      if (request.method === "POST" && path === "/blitz/quotes/ingest/start") {
        ingestor.start();
        return createJsonResponse({ ok: true, action: "ingest-started", nodeName });
      }

      // POST /blitz/quotes/ingest/stop — stop Binance WebSocket ingestion on this node
      if (request.method === "POST" && path === "/blitz/quotes/ingest/stop") {
        ingestor.stop();
        return createJsonResponse({ ok: true, action: "ingest-stopped", nodeName });
      }

      // POST /blitz/quotes/print/start — start printing received quotes on this node
      if (request.method === "POST" && path === "/blitz/quotes/print/start") {
        subscriber.startPrinting();
        return createJsonResponse({ ok: true, action: "print-started", nodeName });
      }

      // POST /blitz/quotes/print/stop — stop printing received quotes on this node
      if (request.method === "POST" && path === "/blitz/quotes/print/stop") {
        subscriber.stopPrinting();
        return createJsonResponse({ ok: true, action: "print-stopped", nodeName });
      }

      // GET /blitz/quotes/recent — last N quotes received by this node
      if (request.method === "GET" && path === "/blitz/quotes/recent") {
        const status = subscriber.getStatus();
        return createJsonResponse({
          nodeName,
          totalReceived: status.totalReceived,
          quotes: status.recentQuotes,
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

/* ------------------------------------------------------------------ */
/*  Cluster size wait                                                  */
/* ------------------------------------------------------------------ */

async function waitForExpectedClusterSize(
  instance: HeliosInstanceImpl,
  nodeName: string,
  expectedClusterSize: number,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (instance.getCluster().getMembers().length >= expectedClusterSize) {
      return;
    }
    await Bun.sleep(250);
  }
  const actual = instance.getCluster().getMembers().length;
  console.warn(
    `[${nodeName}] WARNING: expected cluster size ${expectedClusterSize} but only ${actual} member(s) visible after 30s — continuing anyway`,
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const options = parseArgs(process.argv.slice(2));

  /* --- Helios cluster config --- */

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

  /* --- Start Helios instance --- */

  const instance = (await Helios.newInstance(config)) as HeliosInstanceImpl;
  const restPort = instance.getRestServer().getBoundPort();

  /* --- Start embedded NATS node (forms cluster with other nodes) --- */

  console.log(
    `[${options.name}] starting embedded NATS node (port=${options.natsPort}, cluster=${options.natsClusterPort})...`,
  );

  const natsNodeConfig: ClusterNodeNatsConfig = {
    bindHost: "0.0.0.0",
    advertiseHost: options.name, // Docker service name for inter-container routing
    port: options.natsPort,
    clusterPort: options.natsClusterPort,
    clusterName: "helios-demo-nats",
    serverName: `nats-${options.name}`,
    routes: options.natsRoutes,
    dataDir: `/tmp/nats-${options.name}`,
  };

  let natsManager: NatsServerManager;
  try {
    natsManager = await clusterNode(natsNodeConfig);
    console.log(`[${options.name}] NATS node started on port ${options.natsPort}`);
  } catch (error) {
    console.error(`[${options.name}] Failed to start NATS node:`, error);
    console.log(`[${options.name}] Continuing without Blitz stream processing...`);
    // Fall through — start the rest of the app without Blitz
    startWithoutBlitz(instance, options, restPort);
    return;
  }

  /* --- Connect BlitzService to the local NATS node --- */

  const blitz = await BlitzService.connect({
    servers: `nats://127.0.0.1:${options.natsPort}`,
    maxReconnectAttempts: -1,
    reconnectWaitMs: 1000,
  });

  blitz.on((event, detail) => {
    console.log(`[${options.name}] Blitz event: ${event}`, detail ?? "");
  });

  console.log(`[${options.name}] BlitzService connected to NATS cluster`);

  /* --- Create Binance ingestor and quote subscriber --- */

  const ingestor = createBinanceIngestor(blitz, options.name, options.binanceSymbols);
  const subscriber = createQuoteSubscriber(blitz, options.name);

  // All nodes subscribe to receive quotes (but don't print by default)
  subscriber.ensureSubscribed();

  // node1 starts as the default ingestor (can be changed via API)
  if (options.name === "node1") {
    ingestor.start();
  }

  /* --- Topic bridge + control server --- */

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
    ingestor,
    subscriber,
  );

  /* --- Startup log --- */

  console.log(
    `[${options.name}] started (tcp=${options.tcpPort}, rest=${restPort}, control=${options.controlPort}, nats=${options.natsPort})`,
  );
  if (options.peers.length > 0) {
    console.log(`[${options.name}] seed members: ${options.peers.join(", ")}`);
  }
  if (options.natsRoutes.length > 0) {
    console.log(`[${options.name}] NATS routes: ${options.natsRoutes.join(", ")}`);
  }

  if (options.expectedClusterSize !== null) {
    console.log(
      `[${options.name}] waiting for cluster size ${options.expectedClusterSize}...`,
    );
    await waitForExpectedClusterSize(instance, options.name, options.expectedClusterSize);
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

  Blitz quote streaming:
    GET  /blitz/quotes/status          Quote system status
    GET  /blitz/quotes/recent          Recent quotes received
    POST /blitz/quotes/ingest/start    Start Binance WS ingestion on this node
    POST /blitz/quotes/ingest/stop     Stop Binance WS ingestion on this node
    POST /blitz/quotes/print/start     Start printing quotes to console
    POST /blitz/quotes/print/stop      Stop printing quotes to console
`);

  /* --- Shutdown handler --- */

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`\n[${options.name}] shutting down...`);
    ingestor.stop();
    controlServer.destroy();
    topicBridge.destroy();
    await blitz.shutdown();
    await natsManager.shutdown();
    instance.shutdown();
    console.log(`[${options.name}] goodbye.`);
    process.exit(0);
  };

  process.on("SIGINT", () => { shutdown(); });
  process.on("SIGTERM", () => { shutdown(); });
}

/**
 * Fallback startup without Blitz (e.g. when nats-server binary is missing).
 * Runs the original app behavior without stream processing.
 */
function startWithoutBlitz(
  instance: HeliosInstanceImpl,
  options: AppOptions,
  restPort: number,
): void {
  const topicBridge = createTopicBridge(instance, options.name);
  for (const topicName of options.observedTopics) {
    topicBridge.ensureObserved(topicName);
  }

  const noOpIngestor = {
    start: () => {},
    stop: () => {},
    getStatus: () => ({ active: false, totalIngested: 0, symbols: options.binanceSymbols }),
  };
  const noOpSubscriber = {
    ensureSubscribed: () => {},
    startPrinting: () => {},
    stopPrinting: () => {},
    getStatus: () => ({
      printing: false,
      subscribed: false,
      totalReceived: 0,
      recentQuotes: [] as BinanceQuote[],
    }),
  };

  const controlServer = startControlServer(
    instance,
    options.name,
    restPort,
    options.controlPort,
    topicBridge,
    noOpIngestor,
    noOpSubscriber,
  );

  console.log(
    `[${options.name}] started WITHOUT Blitz (tcp=${options.tcpPort}, rest=${restPort}, control=${options.controlPort})`,
  );

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
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
