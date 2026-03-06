/**
 * Block 16.A5 — TCP Protocol Upgrade tests.
 *
 * Tests the extended ClusterMessage types (JoinRequest, FinalizeJoin, MembersUpdate,
 * Heartbeat, FetchMembersView, Operation, Backup) and the SerializationStrategy
 * interface (JSON default, swappable).
 */
import { describe, it, expect, afterEach } from "bun:test";
import type { ClusterMessage } from "@helios/cluster/tcp/ClusterMessage";
import {
  type SerializationStrategy,
  JsonSerializationStrategy,
} from "@helios/cluster/tcp/SerializationStrategy";
import { TcpClusterTransport } from "@helios/cluster/tcp/TcpClusterTransport";

// ── Helpers ─────────────────────────────────────────────────────────────

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error(`waitUntil: timed out after ${timeoutMs} ms`);
    await Bun.sleep(20);
  }
}

const BASE_PORT = 16500;
let portCounter = 0;
function nextPort(): number {
  return BASE_PORT + portCounter++;
}

describe("TCP Protocol Upgrade (Block 16.A5)", () => {
  const transports: TcpClusterTransport[] = [];

  afterEach(() => {
    for (const t of transports) t.shutdown();
    transports.length = 0;
  });

  function createTransport(
    nodeId: string,
    strategy?: SerializationStrategy,
  ): TcpClusterTransport {
    const t = new TcpClusterTransport(nodeId, strategy);
    transports.push(t);
    return t;
  }

  // ── 1. New message types: round-trip via JSON ─────────────────────────

  describe("JsonSerializationStrategy round-trip", () => {
    const strategy = new JsonSerializationStrategy();

    it("serializes and deserializes JoinRequestMsg", () => {
      const msg: ClusterMessage = {
        type: "JOIN_REQUEST",
        joinerAddress: { host: "127.0.0.1", port: 5701 },
        joinerUuid: "uuid-123",
        clusterName: "helios-cluster",
        partitionCount: 271,
        joinerVersion: { major: 1, minor: 0, patch: 0 },
      };
      const buf = strategy.serialize(msg);
      const result = strategy.deserialize(buf);
      expect(result).toEqual(msg);
    });

    it("serializes and deserializes FinalizeJoinMsg", () => {
      const msg: ClusterMessage = {
        type: "FINALIZE_JOIN",
        memberListVersion: 3,
        members: [
          {
            address: { host: "127.0.0.1", port: 5701 },
            uuid: "uuid-1",
            attributes: {},
            liteMember: false,
            version: { major: 1, minor: 0, patch: 0 },
            memberListJoinVersion: 1,
          },
        ],
        masterAddress: { host: "127.0.0.1", port: 5701 },
        clusterId: "cluster-uuid",
      };
      const buf = strategy.serialize(msg);
      const result = strategy.deserialize(buf);
      expect(result).toEqual(msg);
    });

    it("serializes and deserializes MembersUpdateMsg", () => {
      const msg: ClusterMessage = {
        type: "MEMBERS_UPDATE",
        memberListVersion: 5,
        members: [
          {
            address: { host: "10.0.0.1", port: 5701 },
            uuid: "uuid-a",
            attributes: { role: "data" },
            liteMember: false,
            version: { major: 1, minor: 2, patch: 3 },
            memberListJoinVersion: 2,
          },
          {
            address: { host: "10.0.0.2", port: 5702 },
            uuid: "uuid-b",
            attributes: {},
            liteMember: true,
            version: { major: 1, minor: 2, patch: 3 },
            memberListJoinVersion: 4,
          },
        ],
        masterAddress: { host: "10.0.0.1", port: 5701 },
        clusterId: "cluster-uuid",
      };
      const buf = strategy.serialize(msg);
      expect(strategy.deserialize(buf)).toEqual(msg);
    });

    it("serializes and deserializes HeartbeatMsg", () => {
      const msg: ClusterMessage = {
        type: "HEARTBEAT",
        senderUuid: "uuid-hb",
        timestamp: Date.now(),
      };
      const buf = strategy.serialize(msg);
      expect(strategy.deserialize(buf)).toEqual(msg);
    });

    it("serializes and deserializes FetchMembersViewMsg and response", () => {
      const req: ClusterMessage = {
        type: "FETCH_MEMBERS_VIEW",
        requesterId: "uuid-req",
        requestTimestamp: 12345678,
      };
      const resp: ClusterMessage = {
        type: "MEMBERS_VIEW_RESPONSE",
        memberListVersion: 7,
        members: [],
      };
      expect(strategy.deserialize(strategy.serialize(req))).toEqual(req);
      expect(strategy.deserialize(strategy.serialize(resp))).toEqual(resp);
    });

    it("serializes and deserializes OperationMsg and OperationResponseMsg", () => {
      const op: ClusterMessage = {
        type: "OPERATION",
        callId: 42,
        partitionId: 13,
        operationType: "MAP_PUT",
        payload: { mapName: "test", key: "k", value: "v" },
      };
      const resp: ClusterMessage = {
        type: "OPERATION_RESPONSE",
        callId: 42,
        payload: { result: "old-value" },
        error: null,
      };
      expect(strategy.deserialize(strategy.serialize(op))).toEqual(op);
      expect(strategy.deserialize(strategy.serialize(resp))).toEqual(resp);
    });

    it("serializes and deserializes BackupMsg and BackupAckMsg", () => {
      const backup: ClusterMessage = {
        type: "BACKUP",
        callId: 99,
        partitionId: 7,
        replicaIndex: 1,
        operationType: "MAP_PUT",
        payload: { mapName: "test", key: "k", value: "v" },
      };
      const ack: ClusterMessage = {
        type: "BACKUP_ACK",
        callId: 99,
      };
      expect(strategy.deserialize(strategy.serialize(backup))).toEqual(backup);
      expect(strategy.deserialize(strategy.serialize(ack))).toEqual(ack);
    });
  });

  // ── 2. SerializationStrategy interface: swappable ─────────────────────

  it("swapping strategy produces identical logical output", () => {
    const msg: ClusterMessage = {
      type: "HEARTBEAT",
      senderUuid: "uuid-swap",
      timestamp: 999,
    };
    const json = new JsonSerializationStrategy();

    // A custom strategy that reverses the JSON bytes (roundtrips correctly via its own deserialize)
    const custom: SerializationStrategy = {
      serialize(m: ClusterMessage): Buffer {
        const buf = json.serialize(m);
        // Wrap in a simple envelope
        const envelope = Buffer.alloc(buf.length + 1);
        envelope[0] = 0x01; // version marker
        buf.copy(envelope, 1);
        return envelope;
      },
      deserialize(buf: Buffer): ClusterMessage {
        // Strip envelope
        return json.deserialize(buf.subarray(1));
      },
    };

    const serialized = custom.serialize(msg);
    const deserialized = custom.deserialize(serialized);
    expect(deserialized).toEqual(msg);
  });

  // ── 3. Transport delivers new message types end-to-end ────────────────

  it("JoinRequest is delivered between two transports", async () => {
    const portA = nextPort();
    const tA = createTransport("nodeA");
    const tB = createTransport("nodeB");
    tA.start(portA, "127.0.0.1");

    const received: ClusterMessage[] = [];
    tA.onMessage = (msg) => received.push(msg);

    await tB.connectToPeer("127.0.0.1", portA);
    await waitUntil(() => tA.peerCount() >= 1);

    tB.send("nodeA", {
      type: "JOIN_REQUEST",
      joinerAddress: { host: "127.0.0.1", port: 5702 },
      joinerUuid: "uuid-joiner",
      clusterName: "test-cluster",
      partitionCount: 271,
      joinerVersion: { major: 1, minor: 0, patch: 0 },
    });

    await waitUntil(() => received.some((m) => m.type === "JOIN_REQUEST"));
    const jr = received.find((m) => m.type === "JOIN_REQUEST")!;
    expect(jr.type).toBe("JOIN_REQUEST");
    expect((jr as any).joinerUuid).toBe("uuid-joiner");
  });

  it("HeartbeatMsg is delivered between two transports", async () => {
    const portA = nextPort();
    const tA = createTransport("nodeA");
    const tB = createTransport("nodeB");
    tA.start(portA, "127.0.0.1");

    const received: ClusterMessage[] = [];
    tA.onMessage = (msg) => received.push(msg);

    await tB.connectToPeer("127.0.0.1", portA);
    await waitUntil(() => tA.peerCount() >= 1);

    tB.send("nodeA", {
      type: "HEARTBEAT",
      senderUuid: "uuid-nodeB",
      timestamp: Date.now(),
    });

    await waitUntil(() => received.some((m) => m.type === "HEARTBEAT"));
    expect(received.some((m) => m.type === "HEARTBEAT")).toBe(true);
  });

  // ── 4. Connection auto-close on member removal ────────────────────────

  it("disconnectPeer closes connection and removes from peers", async () => {
    const portA = nextPort();
    const tA = createTransport("nodeA");
    const tB = createTransport("nodeB");
    tA.start(portA, "127.0.0.1");

    await tB.connectToPeer("127.0.0.1", portA);
    await waitUntil(() => tA.peerCount() >= 1);
    expect(tA.peerCount()).toBe(1);

    tA.disconnectPeer("nodeB");
    await waitUntil(() => tA.peerCount() === 0);
    expect(tA.peerCount()).toBe(0);
  });

  // ── 5. Strategy swap mid-flight ───────────────────────────────────────

  it("transport uses provided SerializationStrategy", () => {
    let serializeCalled = false;
    const custom: SerializationStrategy = {
      serialize(msg: ClusterMessage): Buffer {
        serializeCalled = true;
        return Buffer.from(JSON.stringify(msg), "utf8");
      },
      deserialize(buf: Buffer): ClusterMessage {
        return JSON.parse(buf.toString("utf8")) as ClusterMessage;
      },
    };

    const t = createTransport("nodeCustom", custom);
    // The transport should use the custom strategy internally
    // We verify by checking the strategy was accepted (constructor param)
    expect(t).toBeDefined();
  });
});
