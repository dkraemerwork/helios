import { describe, expect, it } from "bun:test";
import { HeliosConfig } from "@zenystx/core/config/HeliosConfig";
import { TopicConfig } from "@zenystx/core/config/TopicConfig";
import { SerializationConfig } from "@zenystx/core/internal/serialization/impl/SerializationConfig";
import { SerializationServiceImpl } from "@zenystx/core/internal/serialization/impl/SerializationServiceImpl";
import type { HeliosClusterCoordinator } from "@zenystx/core/instance/impl/HeliosClusterCoordinator";
import { DistributedTopicService } from "@zenystx/core/topic/impl/DistributedTopicService";
import type { TcpClusterTransport } from "@zenystx/core/cluster/tcp/TcpClusterTransport";

class FakeTransport {
  readonly sends: Array<{ peerId: string; message: unknown }> = [];
  readonly broadcasts: unknown[] = [];

  send(peerId: string, message: unknown): void {
    this.sends.push({ peerId, message });
  }

  broadcast(message: unknown): void {
    this.broadcasts.push(message);
  }
}

class FakeCoordinator {
  constructor(private readonly _ownerId: string) {}

  getOwnerId(): string {
    return this._ownerId;
  }

  getPartitionId(): number {
    return 0;
  }
}

function makeSerializationService(): SerializationServiceImpl {
  return new SerializationServiceImpl(new SerializationConfig());
}

function toData(
  serializationService: SerializationServiceImpl,
  value: unknown,
) {
  const data = serializationService.toData(value);
  if (data === null) {
    throw new Error("Expected non-null serialized value");
  }
  return data;
}

describe("DistributedTopicService", () => {
  it("broadcasts directly when global ordering is disabled", async () => {
    const config = new HeliosConfig("topic-test");
    config.addTopicConfig(
      new TopicConfig("events").setGlobalOrderingEnabled(false),
    );
    const serializationService = makeSerializationService();
    const transport = new FakeTransport();
    const service = new DistributedTopicService(
      "node-b",
      config,
      serializationService,
      transport as unknown as TcpClusterTransport,
      new FakeCoordinator("node-a") as unknown as HeliosClusterCoordinator,
    );
    const received: string[] = [];

    service.addMessageListener<string>("events", (message) => {
      received.push(message.getMessageObject());
    });

    await service.publish("events", toData(serializationService, "hello"));

    expect(received).toEqual(["hello"]);
    expect(transport.sends).toHaveLength(0);
    expect(transport.broadcasts).toHaveLength(1);
    expect((transport.broadcasts[0] as { type: string }).type).toBe(
      "TOPIC_MESSAGE",
    );
  });

  it("routes publishes through the owner when global ordering is enabled", async () => {
    const config = new HeliosConfig("topic-test");
    config.addTopicConfig(
      new TopicConfig("events").setGlobalOrderingEnabled(true),
    );
    const serializationService = makeSerializationService();
    const transport = new FakeTransport();
    const service = new DistributedTopicService(
      "node-b",
      config,
      serializationService,
      transport as unknown as TcpClusterTransport,
      new FakeCoordinator("node-a") as unknown as HeliosClusterCoordinator,
    );

    const publishPromise = service.publish(
      "events",
      toData(serializationService, "hello"),
    );

    expect(transport.broadcasts).toHaveLength(0);
    expect(transport.sends).toHaveLength(1);
    expect(transport.sends[0].peerId).toBe("node-a");
    expect((transport.sends[0].message as { type: string }).type).toBe(
      "TOPIC_PUBLISH_REQUEST",
    );

    const requestId = (transport.sends[0].message as { requestId: string })
      .requestId;
    service.handleMessage({ type: "TOPIC_ACK", requestId });

    await publishPromise;
    expect(
      service.getLocalTopicStats("events").getPublishOperationCount(),
    ).toBe(1);
  });

  it("skips local topic stats when statistics are disabled", async () => {
    const config = new HeliosConfig("topic-test");
    config.addTopicConfig(
      new TopicConfig("events").setStatisticsEnabled(false),
    );
    const serializationService = makeSerializationService();
    const transport = new FakeTransport();
    const service = new DistributedTopicService(
      "node-b",
      config,
      serializationService,
      transport as unknown as TcpClusterTransport,
      new FakeCoordinator("node-b") as unknown as HeliosClusterCoordinator,
    );

    service.addMessageListener<string>("events", () => {});

    await service.publish("events", toData(serializationService, "hello"));

    expect(
      service.getLocalTopicStats("events").getPublishOperationCount(),
    ).toBe(0);
    expect(
      service.getLocalTopicStats("events").getReceiveOperationCount(),
    ).toBe(0);
  });
});
