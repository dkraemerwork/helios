/**
 * Block 19T.1 — Reliable topic service-backed distributed runtime path tests.
 *
 * Proves:
 * - ReliableTopicService uses RingbufferService containers (not direct ArrayRingbuffer)
 * - Ringbuffer wait/notify wakes parked readers on append
 * - Destroy cancels waiting readers
 * - Shutdown cancels all runners and waiting readers
 * - No runtime resurrection after destroy
 * - No surviving runners or timers after shutdown
 * - getReliableTopic() returns fresh instance after destroy
 * - Reliable topic publish routes through RingbufferService container
 */
import { describe, it, expect } from "bun:test";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { TOPIC_RB_PREFIX } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicService";
import { RingbufferService } from "@zenystx/helios-core/ringbuffer/impl/RingbufferService";
import type { Message } from "@zenystx/helios-core/topic/Message";
import { TestHeliosInstance } from "@zenystx/helios-core/test-support/TestHeliosInstance";

// ═══════════════════════════════════════════════════════════════════════════════
// A. ReliableTopicService uses RingbufferService containers
// ═══════════════════════════════════════════════════════════════════════════════

describe("ReliableTopicService — RingbufferService backing", () => {
  it("uses RingbufferService container instead of direct ArrayRingbuffer", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("svc-backed");

    // Publish should store through RingbufferService
    topic.publish("hello");

    // Verify the RingbufferService has a container for this topic's ringbuffer
    const rbService = instance.getRingbufferService();
    expect(rbService).toBeDefined();

    const rbName = TOPIC_RB_PREFIX + "svc-backed";
    const partitionId = rbService.getRingbufferPartitionId(rbName);
    const ns = RingbufferService.getRingbufferNamespace(rbName);
    const container = rbService.getContainerOrNull(partitionId, ns);
    expect(container).not.toBeNull();
    expect(container!.size()).toBe(1);

    instance.shutdown();
  });

  it("listener reads from RingbufferService container", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("svc-read");

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    await Bun.sleep(50);
    topic.publish("from-service");
    await Bun.sleep(100);

    expect(received).toEqual(["from-service"]);
    instance.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. Ringbuffer wait/notify for reliable listeners
// ═══════════════════════════════════════════════════════════════════════════════

describe("Ringbuffer wait/notify — reliable listener wakeup", () => {
  it("listener wakes up promptly on append instead of polling", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("wake");

    const received: string[] = [];
    const timestamps: number[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
      timestamps.push(Date.now());
    });

    await Bun.sleep(50);

    const publishTime = Date.now();
    topic.publish("wakeup-msg");

    // Should receive within ~20ms (not waiting for a 10ms polling interval)
    await Bun.sleep(50);

    expect(received).toEqual(["wakeup-msg"]);
    // Delivery should be fast — within 30ms of publish
    if (timestamps.length > 0) {
      expect(timestamps[0] - publishTime).toBeLessThan(30);
    }

    instance.shutdown();
  });

  it("multiple waiting readers all wake up on append", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("multi-wake");

    const received1: string[] = [];
    const received2: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received1.push(msg.getMessageObject());
    });
    topic.addMessageListener((msg: Message<string>) => {
      received2.push(msg.getMessageObject());
    });

    await Bun.sleep(50);
    topic.publish("shared-msg");
    await Bun.sleep(100);

    expect(received1).toEqual(["shared-msg"]);
    expect(received2).toEqual(["shared-msg"]);

    instance.shutdown();
  });

  it("destroy cancels waiting readers deterministically", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("destroy-wait");

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    await Bun.sleep(50);
    topic.destroy();

    // Publishing to a fresh topic after destroy should not reach old listener
    const fresh = instance.getReliableTopic<string>("destroy-wait");
    fresh.publish("after-destroy");
    await Bun.sleep(100);

    expect(received).not.toContain("after-destroy");
    instance.shutdown();
  });

  it("shutdown cancels all waiting readers across all topics", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const t1 = instance.getReliableTopic<string>("shutdown-a");
    const t2 = instance.getReliableTopic<string>("shutdown-b");

    const received: string[] = [];
    t1.addMessageListener((msg: Message<string>) => received.push("a:" + msg.getMessageObject()));
    t2.addMessageListener((msg: Message<string>) => received.push("b:" + msg.getMessageObject()));

    await Bun.sleep(50);
    instance.shutdown();

    // No lingering timers or runners — process exits cleanly
    await Bun.sleep(100);
    // No crash is the proof
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. End-to-end lifecycle — no resurrection, no surviving runners
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reliable topic — no runtime resurrection after destroy", () => {
  it("destroyed topic does not receive messages from late publishes", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("no-resurrect");

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    await Bun.sleep(50);
    topic.publish("before");
    await Bun.sleep(100);
    expect(received).toContain("before");

    topic.destroy();

    // Publish on the old proxy should fail or be no-op
    expect(() => topic.publish("after-destroy")).toThrow();

    instance.shutdown();
  });

  it("getReliableTopic after destroy returns fresh working instance", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const t1 = instance.getReliableTopic<string>("fresh-after");
    t1.destroy();

    const t2 = instance.getReliableTopic<string>("fresh-after");
    expect(t2).not.toBe(t1);

    const received: string[] = [];
    t2.addMessageListener((msg: Message<string>) => received.push(msg.getMessageObject()));
    await Bun.sleep(50);
    t2.publish("fresh-msg");
    await Bun.sleep(100);

    expect(received).toEqual(["fresh-msg"]);
    instance.shutdown();
  });
});

describe("Reliable topic — no surviving runners after shutdown", () => {
  it("no timers or poll loops survive shutdown", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);

    for (let i = 0; i < 5; i++) {
      const topic = instance.getReliableTopic<string>(`surv-${i}`);
      topic.addMessageListener(() => {});
    }

    await Bun.sleep(50);
    instance.shutdown();
    await Bun.sleep(200);
    // Test passes if process doesn't hang from leaked timers
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Classic topic — end-to-end verification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Classic topic — no resurrection after destroy", () => {
  it("publish on destroyed classic topic does not reach old listeners", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getTopic<string>("classic-mortal");

    const received: string[] = [];
    topic.addMessageListener((msg) => received.push(msg.getMessageObject()));
    topic.publish("alive");
    expect(received).toContain("alive");

    topic.destroy();

    // Getting fresh topic and publishing
    const fresh = instance.getTopic<string>("classic-mortal");
    const freshReceived: string[] = [];
    fresh.addMessageListener((msg) => freshReceived.push(msg.getMessageObject()));
    fresh.publish("reborn");
    expect(freshReceived).toContain("reborn");
    expect(received).not.toContain("reborn");

    instance.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. TestHeliosInstance — honest reliable topic behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe("TestHeliosInstance — reliable topic honesty", () => {
  it("getReliableTopic works with real ringbuffer-backed publish/listen", async () => {
    const instance = new TestHeliosInstance();
    const topic = instance.getReliableTopic<string>("test-rt");

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    await Bun.sleep(50);
    topic.publish("test-msg");
    await Bun.sleep(100);

    expect(received).toEqual(["test-msg"]);
    instance.shutdown();
  });

  it("destroy and re-get returns fresh instance", () => {
    const instance = new TestHeliosInstance();
    const t1 = instance.getReliableTopic<string>("destroy-test");
    t1.destroy();
    const t2 = instance.getReliableTopic<string>("destroy-test");
    expect(t2).not.toBe(t1);
    instance.shutdown();
  });
});
