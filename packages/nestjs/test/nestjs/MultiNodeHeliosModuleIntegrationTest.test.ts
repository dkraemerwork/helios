import { Injectable } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { Helios } from "@zenystx/helios-core/Helios";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import { afterEach, describe, expect, it } from "bun:test";
import "reflect-metadata";
import { HeliosModule } from "../../src/HeliosModule";
import { HeliosObjectExtractionModule } from "../../src/HeliosObjectExtractionModule";
import {
  InjectQueue,
  InjectTopic,
} from "../../src/decorators/inject-distributed-object.decorator";

const BASE_PORT = 18100;

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
    }
    await Bun.sleep(25);
  }
}

async function createNode(
  name: string,
  port: number,
  peers: string[] = [],
): Promise<HeliosInstanceImpl> {
  const config = new HeliosConfig(name);
  config
    .getNetworkConfig()
    .setPort(port)
    .getJoin()
    .getTcpIpConfig()
    .setEnabled(true);
  for (const peer of peers) {
    config.getNetworkConfig().getJoin().getTcpIpConfig().addMember(peer);
  }
  return await Helios.newInstance(config);
}

@Injectable()
class QueueServiceHarness {
  constructor(@InjectQueue("jobs") readonly jobs: IQueue<string>) {}
}

@Injectable()
class TopicServiceHarness {
  readonly received: string[] = [];

  constructor(@InjectTopic("events") readonly events: ITopic<string>) {}

  listen(): void {
    this.events.addMessageListener((message) => {
      this.received.push(message.getMessageObject());
    });
  }
}

describe("Helios NestJS multi-node integration", () => {
  const modules: TestingModule[] = [];
  const instances: HeliosInstanceImpl[] = [];

  afterEach(async () => {
    for (const module of modules.splice(0)) {
      await module.close();
    }
    for (const instance of instances.splice(0)) {
      if (instance.isRunning()) {
        instance.shutdown();
      }
    }
    await Bun.sleep(50);
  });

  it("injects clustered queues and topics through HeliosModule", async () => {
    const nodeA = await createNode("nestjs-node-a", BASE_PORT);
    const nodeB = await createNode("nestjs-node-b", BASE_PORT + 1, [
      `localhost:${BASE_PORT}`,
    ]);
    instances.push(nodeA, nodeB);

    await waitUntil(() => nodeA.getCluster().getMembers().length === 2);
    await waitUntil(() => nodeB.getCluster().getMembers().length === 2);

    const moduleA = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(nodeA),
        HeliosObjectExtractionModule.forRoot({
          namedQueues: ["jobs"],
          namedTopics: ["events"],
        }),
      ],
      providers: [QueueServiceHarness, TopicServiceHarness],
    }).compile();
    const moduleB = await Test.createTestingModule({
      imports: [
        HeliosModule.forRoot(nodeB),
        HeliosObjectExtractionModule.forRoot({
          namedQueues: ["jobs"],
          namedTopics: ["events"],
        }),
      ],
      providers: [QueueServiceHarness, TopicServiceHarness],
    }).compile();
    modules.push(moduleA, moduleB);

    const queueA = moduleA.get(QueueServiceHarness);
    const queueB = moduleB.get(QueueServiceHarness);
    const topicA = moduleA.get(TopicServiceHarness);
    const topicB = moduleB.get(TopicServiceHarness);

    topicB.listen();

    expect(await queueA.jobs.offer("job-1")).toBe(true);
    await waitUntil(async () => (await queueB.jobs.size()) === 1);
    expect(await queueB.jobs.poll()).toBe("job-1");

    await topicA.events.publish("hello from nestjs");
    await waitUntil(() => topicB.received.includes("hello from nestjs"));
    expect(topicB.received).toContain("hello from nestjs");
  });
});
