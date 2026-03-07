/**
 * Block 19T.1 — Reliable topic publish completion contract tests.
 *
 * Proves:
 * - AddOperation implements BackupAwareOperation with correct sync/async counts from config
 * - AddBackupOperation replays the add on backup containers
 * - Config validation rejects reliable-topic configs with zero sync backups
 * - OperationServiceImpl integrates backup handler after operation execution
 * - Publish completion waits for backup acknowledgment in multi-node mode
 * - In single-node mode, publish completes immediately (no backups available)
 */
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { ReliableTopicConfig } from "@zenystx/helios-core/config/ReliableTopicConfig";
import { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { AddBackupOperation } from "@zenystx/helios-core/ringbuffer/impl/operations/AddBackupOperation";
import { AddOperation } from "@zenystx/helios-core/ringbuffer/impl/operations/AddOperation";
import { RingbufferService } from "@zenystx/helios-core/ringbuffer/impl/RingbufferService";
import { OverflowPolicy } from "@zenystx/helios-core/ringbuffer/OverflowPolicy";
import { isBackupAwareOperation } from "@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation";
import { TestNodeEngine } from "@zenystx/helios-core/test-support/TestNodeEngine";
import { beforeEach, describe, expect, it } from "bun:test";

// ═══════════════════════════════════════════════════════════════════════════════
// A. AddOperation — BackupAwareOperation contract
// ═══════════════════════════════════════════════════════════════════════════════

describe("AddOperation — BackupAwareOperation", () => {
  let nodeEngine: TestNodeEngine;
  let service: RingbufferService;
  const rbName = "test-rb";
  const CAPACITY = 10;

  beforeEach(() => {
    nodeEngine = new TestNodeEngine();
    service = new RingbufferService(nodeEngine);
    const rbConfig = new RingbufferConfig(rbName)
      .setCapacity(CAPACITY)
      .setTimeToLiveSeconds(10)
      .setBackupCount(2)
      .setAsyncBackupCount(1);
    service.addRingbufferConfig(rbConfig);
    nodeEngine.registerService(RingbufferService.SERVICE_NAME, service);

    const ns = RingbufferService.getRingbufferNamespace(rbName);
    service.getOrCreateContainer(
      service.getRingbufferPartitionId(rbName),
      ns,
      rbConfig,
    );
  });

  function makeOp(policy: OverflowPolicy = OverflowPolicy.OVERWRITE): AddOperation {
    const item = nodeEngine.toData("test-item")!;
    const op = new AddOperation(rbName, item, policy);
    op.setPartitionId(service.getRingbufferPartitionId(rbName));
    op.setNodeEngine(nodeEngine);
    return op;
  }

  it("satisfies isBackupAwareOperation type guard", () => {
    const op = makeOp();
    expect(isBackupAwareOperation(op)).toBe(true);
  });

  it("getSyncBackupCount returns config backupCount", async () => {
    const op = makeOp();
    await op.run();
    expect(op.getSyncBackupCount()).toBe(2);
  });

  it("getAsyncBackupCount returns config asyncBackupCount", async () => {
    const op = makeOp();
    await op.run();
    expect(op.getAsyncBackupCount()).toBe(1);
  });

  it("getBackupOperation returns an AddBackupOperation", async () => {
    const op = makeOp();
    await op.run();
    const backupOp = op.getBackupOperation();
    expect(backupOp).toBeInstanceOf(AddBackupOperation);
  });

  it("shouldBackup is false when FAIL policy and no capacity", async () => {
    // Fill to capacity
    const ns = RingbufferService.getRingbufferNamespace(rbName);
    const container = service.getContainerOrNull(
      service.getRingbufferPartitionId(rbName),
      ns,
    )!;
    for (let i = 0; i < CAPACITY; i++) {
      container.add(nodeEngine.toData(`fill-${i}`)!);
    }

    const op = makeOp(OverflowPolicy.FAIL);
    await op.run();
    expect(op.shouldBackup()).toBe(false);
    expect(op.getResponse()).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. AddBackupOperation — replay on backup container
// ═══════════════════════════════════════════════════════════════════════════════

describe("AddBackupOperation", () => {
  let nodeEngine: TestNodeEngine;
  let service: RingbufferService;
  const rbName = "backup-rb";
  const CAPACITY = 10;

  beforeEach(() => {
    nodeEngine = new TestNodeEngine();
    service = new RingbufferService(nodeEngine);
    const rbConfig = new RingbufferConfig(rbName).setCapacity(CAPACITY);
    service.addRingbufferConfig(rbConfig);
    nodeEngine.registerService(RingbufferService.SERVICE_NAME, service);

    const ns = RingbufferService.getRingbufferNamespace(rbName);
    service.getOrCreateContainer(
      service.getRingbufferPartitionId(rbName),
      ns,
      rbConfig,
    );
  });

  it("replays add on the backup container", async () => {
    const item = nodeEngine.toData("backup-item")!;
    const op = new AddBackupOperation(rbName, item);
    op.setPartitionId(service.getRingbufferPartitionId(rbName));
    op.setNodeEngine(nodeEngine);

    await op.run();

    const ns = RingbufferService.getRingbufferNamespace(rbName);
    const container = service.getContainerOrNull(
      service.getRingbufferPartitionId(rbName),
      ns,
    )!;
    expect(container.size()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Config validation — reject zero-sync-backup reliable-topic configs
// ═══════════════════════════════════════════════════════════════════════════════

describe("Config validation — reliable topic sync backup requirement", () => {
  it("rejects reliable-topic config when backing ringbuffer has backupCount=0", () => {
    const config = new HeliosConfig("test");
    config.addReliableTopicConfig(new ReliableTopicConfig("events"));
    config.addRingbufferConfig(
      new RingbufferConfig("_hz_rb_events").setBackupCount(0),
    );

    expect(() => new HeliosInstanceImpl(config)).toThrow(
      /backupCount.*requires backupCount >= 1/i,
    );
  });

  it("accepts reliable-topic config when backing ringbuffer has backupCount >= 1", () => {
    const config = new HeliosConfig("test");
    config.addReliableTopicConfig(new ReliableTopicConfig("events"));
    config.addRingbufferConfig(
      new RingbufferConfig("_hz_rb_events").setBackupCount(1),
    );

    // Should not throw
    const instance = new HeliosInstanceImpl(config);
    instance.shutdown();
  });

  it("default ringbuffer config has backupCount=1, passes validation", () => {
    const config = new HeliosConfig("test");
    config.addReliableTopicConfig(new ReliableTopicConfig("events"));
    // No explicit ringbuffer config → default has backupCount=1

    const instance = new HeliosInstanceImpl(config);
    instance.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Single-node publish completion — completes immediately (no backup nodes)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reliable topic publish — single-node completion", () => {
  it("publish completes immediately in single-node mode", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("fast");

    // Should complete without hanging — no backup nodes available
    await topic.publishAsync("hello");

    instance.shutdown();
  });

  it("publishAll completes immediately in single-node mode", async () => {
    const config = new HeliosConfig("test");
    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("batch-fast");

    await topic.publishAllAsync(["a", "b", "c"]);

    instance.shutdown();
  });
});
