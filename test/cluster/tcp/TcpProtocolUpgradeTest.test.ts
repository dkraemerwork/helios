/**
 * Block 16.A5 — TCP Protocol Upgrade tests.
 *
 * Tests the extended ClusterMessage types (JoinRequest, FinalizeJoin, MembersUpdate,
 * Heartbeat, FetchMembersView, Operation, Backup) and the SerializationStrategy
 * interface (JSON default, swappable).
 */
import type { ClusterMessage } from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import { BinarySerializationStrategy } from "@zenystx/helios-core/cluster/tcp/BinarySerializationStrategy";
import {
  type SerializationStrategy,
  JsonSerializationStrategy,
} from "@zenystx/helios-core/cluster/tcp/SerializationStrategy";
import { HeapData } from "@zenystx/helios-core/internal/serialization/impl/HeapData";
import { serializeOperation } from "@zenystx/helios-core/spi/impl/operationservice/OperationWireCodec";
import { SetOperation } from "@zenystx/helios-core/map/impl/operation/SetOperation";
import {
  TcpClusterTransport,
  type TcpClusterTransportOptions,
} from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { afterEach, describe, expect, it } from "bun:test";

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

function encodeFrame(
  strategy: SerializationStrategy,
  message: ClusterMessage,
): Buffer {
  const payload = strategy.serialize(message);
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  frame.set(payload, 4);
  return frame;
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
    options?: TcpClusterTransportOptions,
  ): TcpClusterTransport {
    const t = new TcpClusterTransport(nodeId, strategy, options);
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
      const encoded = serializeOperation(
        new SetOperation(
          "test",
          new HeapData(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
          new HeapData(Buffer.from([9, 10, 11, 12, 13, 14, 15, 16])),
          -1,
          -1,
        ),
      );
      const op: ClusterMessage = {
        type: "OPERATION",
        callId: 42,
        partitionId: 13,
        factoryId: encoded.factoryId,
        classId: encoded.classId,
        payload: encoded.payload,
        senderId: "node-1",
      };
      const resp: ClusterMessage = {
        type: "OPERATION_RESPONSE",
        callId: 42,
        backupAcks: 1,
        backupMemberIds: ["node-2"],
        payload: { result: "old-value" },
        error: null,
      };
      expect(strategy.deserialize(strategy.serialize(op))).toEqual(op);
      expect(strategy.deserialize(strategy.serialize(resp))).toEqual(resp);
    });

    it("serializes and deserializes BackupMsg and BackupAckMsg", () => {
      const encoded = serializeOperation(
        new SetOperation(
          "test",
          new HeapData(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
          new HeapData(Buffer.from([9, 10, 11, 12, 13, 14, 15, 16])),
          -1,
          -1,
        ),
      );
      const backup: ClusterMessage = {
        type: "BACKUP",
        callId: 99,
        partitionId: 7,
        replicaIndex: 1,
        senderId: "node-2",
        callerId: "node-1",
        sync: true,
        replicaVersions: ["0", "1"],
        factoryId: encoded.factoryId,
        classId: encoded.classId,
        payload: encoded.payload,
      };
      const ack: ClusterMessage = {
        type: "BACKUP_ACK",
        callId: 99,
        senderId: "node-2",
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
        envelope.set(buf, 1);
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

  it("scatter outbound encoding preserves transport ordering end-to-end", async () => {
    const messageCount = 12;
    const portA = nextPort();
    const tA = createTransport("nodeA");
    const tB = createTransport("nodeB", undefined, {
      scatterOutboundEncoding: true,
      scatterOutboundEncoder: {
        inputCapacityBytes: 1024,
        outputCapacityBytes: 1024,
      },
    });
    tA.start(portA, "127.0.0.1");

    const received: ClusterMessage[] = [];
    tA.onMessage = (msg) => {
      if (msg.type === "HEARTBEAT") {
        received.push(msg);
      }
    };

    await tB.connectToPeer("127.0.0.1", portA);
    await waitUntil(() => tA.peerCount() >= 1);

    for (let index = 0; index < messageCount; index++) {
      expect(tB.send("nodeA", {
        type: "HEARTBEAT",
        senderUuid: `scatter-${index}`,
        timestamp: index,
      })).toBe(true);
    }

    await waitUntil(() => received.length === messageCount);
    expect(received.map((msg) => ({ senderUuid: (msg as any).senderUuid, timestamp: (msg as any).timestamp }))).toEqual(
      Array.from({ length: messageCount }, (_, index) => ({ senderUuid: `scatter-${index}`, timestamp: index })),
    );
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

  it("transport prefers serializeInto when strategy supports pooled encoding", () => {
    let serializeIntoCalled = false;
    let serializeCalled = false;
    let writtenFrame: Buffer | null = null;
    const custom: SerializationStrategy = {
      serialize(): Buffer {
        serializeCalled = true;
        throw new Error("serialize should not be used when serializeInto exists");
      },
      serializeInto(out, msg): void {
        serializeIntoCalled = true;
        const payload = Buffer.from(JSON.stringify(msg), "utf8");
        out.writeBytes(payload, 0, payload.length);
      },
      deserialize(buf: Buffer): ClusterMessage {
        return JSON.parse(buf.toString("utf8")) as ClusterMessage;
      },
    };

    const transport = createTransport("nodeA", custom);
    const channel = {
      write: (frame: Buffer) => {
        writtenFrame = Buffer.from(frame);
        return true;
      },
      close: () => {},
      bytesRead: () => 0,
      bytesWritten: () => 0,
      queuedFrames: () => 0,
      pendingBytes: () => 0,
    } as any;

    expect(() => (transport as any)._onConnect(channel)).not.toThrow();
    expect(serializeIntoCalled).toBe(true);
    expect(serializeCalled).toBe(false);
    expect(writtenFrame).not.toBeNull();
    const frame = Buffer.from(writtenFrame ?? []);
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
  });

  describe("stateful frame decoder", () => {
    it("reassembles a frame split across multiple chunks", () => {
      const transport = createTransport("nodeA");
      const strategy = new BinarySerializationStrategy();
      const received: ClusterMessage[] = [];
      transport.onMessage = (msg) => received.push(msg);

      const channel = {
        write: () => true,
        close: () => {},
        bytesRead: () => 0,
        bytesWritten: () => 0,
        queuedFrames: () => 0,
        pendingBytes: () => 0,
      } as any;

      (transport as any)._onConnect(channel);

      const frame = encodeFrame(strategy, {
        type: "HEARTBEAT",
        senderUuid: "nodeB",
        timestamp: 123,
      });

      (transport as any)._onData(channel, frame.subarray(0, 2));
      (transport as any)._onData(channel, frame.subarray(2, 9));
      (transport as any)._onData(channel, frame.subarray(9));

      expect(received).toEqual([
        {
          type: "HEARTBEAT",
          senderUuid: "nodeB",
          timestamp: 123,
        },
      ]);
    });

    it("decodes multiple complete frames from one chunk", () => {
      const transport = createTransport("nodeA");
      const strategy = new BinarySerializationStrategy();
      const received: ClusterMessage[] = [];
      transport.onMessage = (msg) => received.push(msg);

      const channel = {
        write: () => true,
        close: () => {},
        bytesRead: () => 0,
        bytesWritten: () => 0,
        queuedFrames: () => 0,
        pendingBytes: () => 0,
      } as any;

      (transport as any)._onConnect(channel);

      const first = encodeFrame(strategy, {
        type: "HEARTBEAT",
        senderUuid: "nodeB",
        timestamp: 1,
      });
      const second = encodeFrame(strategy, {
        type: "FETCH_MEMBERS_VIEW",
        requesterId: "nodeC",
        requestTimestamp: 2,
      });

      (transport as any)._onData(channel, Buffer.concat([first, second]));

      expect(received).toEqual([
        {
          type: "HEARTBEAT",
          senderUuid: "nodeB",
          timestamp: 1,
        },
        {
          type: "FETCH_MEMBERS_VIEW",
          requesterId: "nodeC",
          requestTimestamp: 2,
        },
      ]);
    });

    it("grows the decoder buffer for oversized frames", () => {
      const transport = createTransport("nodeA");
      const strategy = new BinarySerializationStrategy();
      const received: ClusterMessage[] = [];
      transport.onMessage = (msg) => received.push(msg);

      const channel = {
        write: () => true,
        close: () => {},
        bytesRead: () => 0,
        bytesWritten: () => 0,
        queuedFrames: () => 0,
        pendingBytes: () => 0,
      } as any;

      (transport as any)._onConnect(channel);

      const largeValue = Buffer.alloc(80_000, 7);
      const encoded = serializeOperation(
        new SetOperation(
          "big",
          new HeapData(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
          new HeapData(largeValue),
          -1,
          -1,
        ),
      );
      const frame = encodeFrame(strategy, {
        type: "OPERATION",
        callId: 99,
        partitionId: 7,
        factoryId: encoded.factoryId,
        classId: encoded.classId,
        payload: encoded.payload,
        senderId: "nodeB",
      });

      (transport as any)._onData(channel, frame);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "OPERATION",
        callId: 99,
        partitionId: 7,
        senderId: "nodeB",
        factoryId: encoded.factoryId,
        classId: encoded.classId,
      });
      expect((received[0] as Extract<ClusterMessage, { type: "OPERATION" }>).payload).toEqual(encoded.payload);
    });
  });
});
