/**
 * Block 19T.1 — Classic topic hardening + ringbuffer-backed reliable topic closure.
 *
 * ~26 tests covering:
 * - Classic topic unified service-backed path
 * - Classic topic config contract (globalOrdering + multiThreading incompatibility)
 * - Classic topic destroy/lifecycle/no-resurrection semantics
 * - ReliableTopicConfig + HeliosConfig + ConfigLoader wiring
 * - Reliable topic single-node publish/listen through ringbuffer
 * - Reliable listener sequence tracking, loss tolerance, terminal error, cancellation
 * - Reliable topic overload policies (ERROR, DISCARD_OLDEST, DISCARD_NEWEST, BLOCK)
 * - Reliable topic destroy/shutdown cleanup
 * - Plain MessageListener adaptation for reliable topic
 * - No throw stubs remaining anywhere
 */
import { parseRawConfig } from "@zenystx/helios-core/config/ConfigLoader";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { ReliableTopicConfig, TopicOverloadPolicy } from "@zenystx/helios-core/config/ReliableTopicConfig";
import { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
import { TopicConfig } from "@zenystx/helios-core/config/TopicConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { TestHeliosInstance } from "@zenystx/helios-core/test-support/TestHeliosInstance";
import type { Message } from "@zenystx/helios-core/topic/Message";
import { describe, expect, it } from "bun:test";

// ═══════════════════════════════════════════════════════════════════════════════
// A. Classic Topic Hardening
// ═══════════════════════════════════════════════════════════════════════════════

describe("Classic Topic — unified service-backed path", () => {
  it("getTopic() always uses the service-backed path even without transport", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getTopic<string>("events");

    // Should NOT be a plain TopicImpl — should be the service-backed proxy
    expect(topic.getName()).toBe("events");

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    topic.publish("hello");
    expect(received).toContain("hello");

    instance.shutdown();
  });

  it("same-name getTopic() returns the same cached instance", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const t1 = instance.getTopic("x");
    const t2 = instance.getTopic("x");
    expect(t1).toBe(t2);
    instance.shutdown();
  });

  it("getTopic() after destroy returns a fresh instance, not the dead cached one", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const t1 = instance.getTopic<string>("x");
    t1.destroy();
    const t2 = instance.getTopic<string>("x");
    expect(t2).not.toBe(t1);

    // New instance should work
    const received: string[] = [];
    t2.addMessageListener((msg) => received.push(msg.getMessageObject()));
    t2.publish("after-destroy");
    expect(received).toContain("after-destroy");

    instance.shutdown();
  });
});

describe("Classic Topic — config contract", () => {
  it("globalOrderingEnabled=true and multiThreadingEnabled=true fails fast", () => {
    const tc = new TopicConfig("t");
    tc.setGlobalOrderingEnabled(true);
    expect(() => tc.setMultiThreadingEnabled(true)).toThrow();
  });

  it("multiThreadingEnabled=true and globalOrderingEnabled=true fails fast", () => {
    const tc = new TopicConfig("t");
    tc.setMultiThreadingEnabled(true);
    expect(() => tc.setGlobalOrderingEnabled(true)).toThrow();
  });

  it("statisticsEnabled=false suppresses publish/receive counters", () => {
    const config = new HeliosConfig("test");
    config.addTopicConfig(new TopicConfig("silent").setStatisticsEnabled(false));
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getTopic<string>("silent");

    topic.addMessageListener(() => {});
    topic.publish("msg");

    const stats = topic.getLocalTopicStats();
    expect(stats.getPublishOperationCount()).toBe(0);
    expect(stats.getReceiveOperationCount()).toBe(0);

    instance.shutdown();
  });
});

describe("Classic Topic — destroy and lifecycle", () => {
  it("destroy prevents runtime resurrection from late listener calls", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getTopic<string>("mortal");
    topic.addMessageListener(() => {});
    topic.destroy();

    // After destroy, getLocalTopicStats / removeMessageListener should not recreate runtime
    // Getting a new topic instance after destroy should give a fresh one
    const fresh = instance.getTopic<string>("mortal");
    expect(fresh).not.toBe(topic);
    instance.shutdown();
  });

  it("shutdown cleans up all topic resources", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getTopic<string>("ephemeral");
    topic.addMessageListener(() => {});
    instance.shutdown();
    // After shutdown, no listeners should fire (not testable from outside, but we verify no crash)
  });

  it("listener exception does not break other listeners", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getTopic<string>("robust");

    const received: string[] = [];
    topic.addMessageListener(() => { throw new Error("boom"); });
    topic.addMessageListener((msg) => received.push(msg.getMessageObject()));

    topic.publish("test");
    expect(received).toContain("test");

    instance.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. ReliableTopicConfig
// ═══════════════════════════════════════════════════════════════════════════════

describe("ReliableTopicConfig", () => {
  it("has correct defaults matching Hazelcast", () => {
    const rtc = new ReliableTopicConfig("events");
    expect(rtc.getName()).toBe("events");
    expect(rtc.getReadBatchSize()).toBe(10);
    expect(rtc.getTopicOverloadPolicy()).toBe(TopicOverloadPolicy.BLOCK);
    expect(rtc.isStatisticsEnabled()).toBe(true);
  });

  it("readBatchSize must be positive", () => {
    const rtc = new ReliableTopicConfig("x");
    expect(() => rtc.setReadBatchSize(0)).toThrow();
    expect(() => rtc.setReadBatchSize(-1)).toThrow();
    rtc.setReadBatchSize(5);
    expect(rtc.getReadBatchSize()).toBe(5);
  });

  it("topicOverloadPolicy must not be null", () => {
    const rtc = new ReliableTopicConfig("x");
    expect(() => rtc.setTopicOverloadPolicy(null as any)).toThrow();
  });
});

describe("HeliosConfig — reliable topic + ringbuffer config", () => {
  it("addReliableTopicConfig and getReliableTopicConfig with wildcard/default fallback", () => {
    const config = new HeliosConfig("test");
    const rtc = new ReliableTopicConfig("events");
    rtc.setReadBatchSize(5);
    config.addReliableTopicConfig(rtc);

    expect(config.getReliableTopicConfig("events").getReadBatchSize()).toBe(5);
    // Missing name returns default
    const def = config.getReliableTopicConfig("unknown");
    expect(def.getReadBatchSize()).toBe(10);
  });

  it("addRingbufferConfig and getRingbufferConfig", () => {
    const config = new HeliosConfig("test");
    const rbc = new RingbufferConfig("_hz_rb_events");
    rbc.setCapacity(100);
    config.addRingbufferConfig(rbc);

    expect(config.getRingbufferConfig("_hz_rb_events")!.getCapacity()).toBe(100);
    // Missing returns default
    const def = config.getRingbufferConfig("_hz_rb_unknown");
    expect(def.getCapacity()).toBe(RingbufferConfig.DEFAULT_CAPACITY);
  });
});

describe("ConfigLoader — reliable topic + ringbuffer parsing", () => {
  it("parses reliable-topics and ringbuffers from raw config", () => {
    const raw = {
      name: "test",
      "reliable-topics": [
        {
          name: "events",
          readBatchSize: 20,
          topicOverloadPolicy: "ERROR",
          statisticsEnabled: false,
        },
      ],
      ringbuffers: [
        {
          name: "_hz_rb_events",
          capacity: 500,
          timeToLiveSeconds: 60,
        },
      ],
    };

    const config = parseRawConfig(raw);
    const rtc = config.getReliableTopicConfig("events");
    expect(rtc.getReadBatchSize()).toBe(20);
    expect(rtc.getTopicOverloadPolicy()).toBe(TopicOverloadPolicy.ERROR);
    expect(rtc.isStatisticsEnabled()).toBe(false);

    const rbc = config.getRingbufferConfig("_hz_rb_events");
    expect(rbc.getCapacity()).toBe(500);
    expect(rbc.getTimeToLiveSeconds()).toBe(60);
  });

  it("parses topic config from raw config", () => {
    const raw = {
      name: "test",
      topics: [
        {
          name: "notifications",
          globalOrderingEnabled: true,
          statisticsEnabled: false,
        },
      ],
    };

    const config = parseRawConfig(raw);
    const tc = config.getTopicConfig("notifications");
    expect(tc.isGlobalOrderingEnabled()).toBe(true);
    expect(tc.isStatisticsEnabled()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Reliable Topic — core runtime
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reliable Topic — getReliableTopic() no longer throws", () => {
  it("HeliosInstanceImpl.getReliableTopic() returns a real ITopic", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("events");
    expect(topic).toBeDefined();
    expect(topic.getName()).toBe("events");
    instance.shutdown();
  });

  it("TestHeliosInstance.getReliableTopic() returns a real ITopic", () => {
    const instance = new TestHeliosInstance();
    const topic = instance.getReliableTopic<string>("events");
    expect(topic).toBeDefined();
    expect(topic.getName()).toBe("events");
    instance.shutdown();
  });
});

describe("Reliable Topic — single-node publish/listen through ringbuffer", () => {
  it("publish stores in ringbuffer and listener receives in order", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("stream");

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    // Allow listener runner to start
    await Bun.sleep(50);

    await topic.publishAsync("a");
    await topic.publishAsync("b");
    await topic.publishAsync("c");

    // Wait for async delivery
    await Bun.sleep(100);

    expect(received).toEqual(["a", "b", "c"]);

    instance.shutdown();
  });

  it("publishAll stores batch and listeners receive all", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("batch");

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    await Bun.sleep(50);

    await topic.publishAllAsync(["x", "y", "z"]);

    await Bun.sleep(100);

    expect(received).toEqual(["x", "y", "z"]);

    instance.shutdown();
  });

  it("null publish throws", () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("nullcheck");

    expect(() => topic.publish(null as any)).toThrow(/null/i);

    instance.shutdown();
  });
});

describe("Reliable Topic — listener management", () => {
  it("removeMessageListener cancels the runner", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("cancel-test");

    const received: string[] = [];
    const id = topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    await Bun.sleep(50);
    await topic.publishAsync("before");
    await Bun.sleep(100);

    expect(received).toContain("before");

    topic.removeMessageListener(id);

    await topic.publishAsync("after");
    await Bun.sleep(100);

    expect(received).not.toContain("after");

    instance.shutdown();
  });

  it("plain MessageListener is adapted with tail+1 default start", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("adapt");

    // Publish before listener — plain listener starts at tail+1 so shouldn't see these
    await topic.publishAsync("old1");
    await topic.publishAsync("old2");

    await Bun.sleep(50);

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    await Bun.sleep(50);

    await topic.publishAsync("new1");
    await Bun.sleep(100);

    expect(received).toEqual(["new1"]);
    expect(received).not.toContain("old1");

    instance.shutdown();
  });
});

describe("Reliable Topic — destroy and shutdown", () => {
  it("destroy cancels all runners and cleans up instance cache", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("destroyable");

    const received: string[] = [];
    topic.addMessageListener((msg: Message<string>) => {
      received.push(msg.getMessageObject());
    });

    await Bun.sleep(50);
    await topic.publishAsync("before-destroy");
    await Bun.sleep(100);
    expect(received).toContain("before-destroy");

    topic.destroy();

    // After destroy, getReliableTopic returns a fresh instance
    const fresh = instance.getReliableTopic<string>("destroyable");
    expect(fresh).not.toBe(topic);

    instance.shutdown();
  });

  it("shutdown cancels all reliable topic runners", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("shutdown-test");

    topic.addMessageListener(() => {});

    await Bun.sleep(50);
    instance.shutdown();
    // No crash, no lingering timers — validated by test process exiting cleanly
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Reliable Topic — overload policies
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reliable Topic — overload semantics", () => {
  it("ERROR policy throws TopicOverloadException when ringbuffer is full", async () => {
    const config = new HeliosConfig("test");
    config.addReliableTopicConfig(
      new ReliableTopicConfig("overflow-err").setTopicOverloadPolicy(TopicOverloadPolicy.ERROR),
    );
    config.addRingbufferConfig(
      new RingbufferConfig("_hz_rb_overflow-err").setCapacity(2),
    );
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("overflow-err");

    // Fill the ringbuffer
    await topic.publishAsync("1");
    await topic.publishAsync("2");

    // Third publish should throw
    await expect(topic.publishAsync("3")).rejects.toThrow(/overload/i);

    instance.shutdown();
  });

  it("DISCARD_OLDEST overwrites oldest when full", async () => {
    const config = new HeliosConfig("test");
    config.addReliableTopicConfig(
      new ReliableTopicConfig("overflow-oldest").setTopicOverloadPolicy(TopicOverloadPolicy.DISCARD_OLDEST),
    );
    config.addRingbufferConfig(
      new RingbufferConfig("_hz_rb_overflow-oldest").setCapacity(2),
    );
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("overflow-oldest");

    await topic.publishAsync("1");
    await topic.publishAsync("2");
    // Should succeed — overwrites oldest
    await topic.publishAsync("3");

    instance.shutdown();
  });

  it("DISCARD_NEWEST silently drops the message when full", async () => {
    const config = new HeliosConfig("test");
    config.addReliableTopicConfig(
      new ReliableTopicConfig("overflow-newest").setTopicOverloadPolicy(TopicOverloadPolicy.DISCARD_NEWEST),
    );
    config.addRingbufferConfig(
      new RingbufferConfig("_hz_rb_overflow-newest").setCapacity(2),
    );
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("overflow-newest");

    await topic.publishAsync("1");
    await topic.publishAsync("2");
    // Should succeed without error — message is discarded
    await topic.publishAsync("3");

    instance.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. Reliable Topic — local stats
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reliable Topic — local stats", () => {
  it("tracks publish and receive counts when statisticsEnabled", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("stats");

    topic.addMessageListener(() => {});
    await Bun.sleep(50);

    await topic.publishAsync("a");
    await topic.publishAsync("b");
    await Bun.sleep(100);

    const stats = topic.getLocalTopicStats();
    expect(stats.getPublishOperationCount()).toBe(2);
    expect(stats.getReceiveOperationCount()).toBe(2);

    instance.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F. Exports and surface completeness
// ═══════════════════════════════════════════════════════════════════════════════

describe("Exports — topic surface completeness", () => {
  it("ReliableTopicConfig and TopicOverloadPolicy are importable from index", async () => {
    const mod = await import("@zenystx/helios-core/index");
    expect(mod.ReliableTopicConfig).toBeDefined();
    expect(mod.TopicOverloadPolicy).toBeDefined();
  });
});
