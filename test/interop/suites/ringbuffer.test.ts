import { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
import { HazelcastSerializationConfig } from "@zenystx/helios-core/internal/serialization/HazelcastSerializationService";
import { Client, OverflowPolicy } from "hazelcast-client";
import { afterEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client - Ringbuffer", () => {
  let cluster: HeliosTestCluster | null = null;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>> | null = null;

  afterEach(async () => {
    if (hzClient !== null) {
      try {
        await hzClient.shutdown();
      } catch {
        // Ignore disconnect races during cleanup.
      }
      hzClient = null;
    }

    if (cluster !== null) {
      await cluster.shutdown();
      cluster = null;
    }
  });

  it("supports official-client add, addAll, readOne, and readMany sequence metadata", async () => {
    const name = "interop-ringbuffer-basic";
    cluster = new HeliosTestCluster({
      configureMember: (config) => {
        attachSerializationConfig(config);
        config.addRingbufferConfig(new RingbufferConfig(name).setCapacity(5));
      },
    });

    const { clusterName, addresses } = await cluster.startSingle();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    const ringbuffer = await hzClient.getRingbuffer<string>(name);

    expect((await ringbuffer.capacity()).toNumber()).toBe(5);
    expect((await ringbuffer.size()).toNumber()).toBe(0);
    expect((await ringbuffer.headSequence()).toNumber()).toBe(0);
    expect((await ringbuffer.tailSequence()).toNumber()).toBe(-1);
    expect((await ringbuffer.remainingCapacity()).toNumber()).toBe(5);

    expect((await ringbuffer.add("event-1")).toNumber()).toBe(0);
    expect((await ringbuffer.addAll(["event-2", "event-3"])).toNumber()).toBe(2);

    expect(await ringbuffer.readOne(1)).toBe("event-2");
    expect((await ringbuffer.size()).toNumber()).toBe(3);
    expect((await ringbuffer.headSequence()).toNumber()).toBe(0);
    expect((await ringbuffer.tailSequence()).toNumber()).toBe(2);
    expect((await ringbuffer.remainingCapacity()).toNumber()).toBe(5);

    const batch = await ringbuffer.readMany(0, 1, 10);
    expect(batch.getReadCount()).toBe(3);
    expect(batch.size()).toBe(3);
    expect([...batch]).toEqual(["event-1", "event-2", "event-3"]);
    expect(batch.getSequence(0)?.toNumber()).toBe(0);
    expect(batch.getSequence(1)?.toNumber()).toBe(1);
    expect(batch.getSequence(2)?.toNumber()).toBe(2);
    expect(batch.getNextSequenceToReadFrom().toNumber()).toBe(3);
  });

  it("enforces overflow policy and clamps stale readMany requests", async () => {
    const name = "interop-ringbuffer-overflow";
    cluster = new HeliosTestCluster({
      configureMember: (config) => {
        attachSerializationConfig(config);
        config.addRingbufferConfig(new RingbufferConfig(name).setCapacity(2));
      },
    });

    const { clusterName, addresses } = await cluster.startSingle();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    const ringbuffer = await hzClient.getRingbuffer<string>(name);

    expect((await ringbuffer.add("a", OverflowPolicy.FAIL)).toNumber()).toBe(0);
    expect((await ringbuffer.add("b", OverflowPolicy.FAIL)).toNumber()).toBe(1);
    expect((await ringbuffer.add("c", OverflowPolicy.FAIL)).toNumber()).toBe(-1);

    expect((await ringbuffer.add("c", OverflowPolicy.OVERWRITE)).toNumber()).toBe(2);
    expect((await ringbuffer.headSequence()).toNumber()).toBe(1);
    expect((await ringbuffer.tailSequence()).toNumber()).toBe(2);
    expect((await ringbuffer.size()).toNumber()).toBe(2);

    const batch = await ringbuffer.readMany(0, 1, 10);
    expect(batch.getReadCount()).toBe(2);
    expect([...batch]).toEqual(["b", "c"]);
    expect(batch.getSequence(0)?.toNumber()).toBe(1);
    expect(batch.getSequence(1)?.toNumber()).toBe(2);
    expect(batch.getNextSequenceToReadFrom().toNumber()).toBe(3);
  });

  it("preserves ringbuffer state and sequence continuity across client reconnect", async () => {
    const name = "interop-ringbuffer-reconnect";
    cluster = new HeliosTestCluster({
      configureMember: (config) => {
        attachSerializationConfig(config);
        config.addRingbufferConfig(new RingbufferConfig(name).setCapacity(10));
      },
    });

    const { clusterName, addresses } = await cluster.startSingle();

    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    const ringbuffer = await hzClient.getRingbuffer<string>(name);
    await ringbuffer.addAll(["event-1", "event-2", "event-3"]);

    await hzClient.shutdown();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    const reconnectedRingbuffer = await hzClient.getRingbuffer<string>(name);
    const afterReconnect = await reconnectedRingbuffer.readMany(0, 1, 10);
    expect([...afterReconnect]).toEqual(["event-1", "event-2", "event-3"]);
    expect(afterReconnect.getSequence(0)?.toNumber()).toBe(0);
    expect(afterReconnect.getSequence(2)?.toNumber()).toBe(2);
    expect(afterReconnect.getNextSequenceToReadFrom().toNumber()).toBe(3);

    expect((await reconnectedRingbuffer.add("event-4")).toNumber()).toBe(3);
    expect(await reconnectedRingbuffer.readOne(3)).toBe("event-4");
    expect((await reconnectedRingbuffer.headSequence()).toNumber()).toBe(0);
    expect((await reconnectedRingbuffer.tailSequence()).toNumber()).toBe(3);
  });
});

function attachSerializationConfig(config: object): void {
  const configWithSerialization = config as {
    _serializationConfig?: HazelcastSerializationConfig;
    getSerializationConfig?: () => HazelcastSerializationConfig;
  };

  const serialization = configWithSerialization._serializationConfig ?? new HazelcastSerializationConfig();
  configWithSerialization._serializationConfig = serialization;
  configWithSerialization.getSerializationConfig = () => serialization;
}
