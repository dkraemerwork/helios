import { HeliosClient } from '@zenystx/helios-core/client';
import { ClientConfig } from '@zenystx/helios-core/client/config/ClientConfig';
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { MapGetCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapGetCodec';
import { MapPutCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec';
import { QueueOfferCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueueOfferCodec';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { LocalQueueStats } from '@zenystx/helios-core/collection/LocalQueueStats';
import type { LocalTopicStats } from '@zenystx/helios-core/topic/LocalTopicStats';
import { afterEach, describe, expect, test } from 'bun:test';

class TestClientSession {
    constructor(private readonly _sessionId: string) {}

    isAuthenticated(): boolean { return true; }
    getSessionId(): string { return this._sessionId; }
    pushEvent(_message: ClientMessage): boolean { return true; }
    sendMessage(_message: ClientMessage): boolean { return true; }
}

async function waitForOperationCount(instance: HeliosInstanceImpl, minimumCount: number): Promise<number> {
    const registry = instance.getMetricsRegistry();
    const provider = instance.getMonitorStateProvider();
    expect(registry).not.toBeNull();
    expect(provider).not.toBeNull();

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        const payload = registry!.buildPayload(provider!);
        const completedCount = payload.latest?.operation.completedCount ?? 0;
        if (completedCount >= minimumCount) {
            return completedCount;
        }
        await Bun.sleep(25);
    }

    return registry!.buildPayload(provider!).latest?.operation.completedCount ?? 0;
}

async function waitForQueueAndTopicStats(instance: HeliosInstanceImpl): Promise<{
    queueStats: LocalQueueStats | null;
    topicStats: LocalTopicStats | null;
}> {
    const registry = instance.getMetricsRegistry();
    const provider = instance.getMonitorStateProvider();
    expect(registry).not.toBeNull();
    expect(provider).not.toBeNull();

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        const payload = registry!.buildPayload(provider!);
        const queueStats = (payload.queueStats['metrics-queue-activity'] as LocalQueueStats | undefined) ?? null;
        const topicStats = (payload.topicStats['metrics-topic-activity'] as LocalTopicStats | undefined) ?? null;

        if ((queueStats?.getOfferOperationCount() ?? 0) >= 1
            && (queueStats?.getPollOperationCount() ?? 0) >= 1
            && (topicStats?.getPublishOperationCount() ?? 0) >= 1
            && (topicStats?.getReceiveOperationCount() ?? 0) >= 1) {
            return { queueStats, topicStats };
        }

        await Bun.sleep(25);
    }

    const payload = registry!.buildPayload(provider!);
    return {
        queueStats: (payload.queueStats['metrics-queue-activity'] as LocalQueueStats | undefined) ?? null,
        topicStats: (payload.topicStats['metrics-topic-activity'] as LocalTopicStats | undefined) ?? null,
    };
}

describe('client protocol monitor metrics', () => {
    const clients: HeliosClient[] = [];
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (clients.length > 0) {
            clients.pop()!.shutdown();
        }
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('monitor payload counts member-side client protocol operations', async () => {
        const config = new HeliosConfig('client-protocol-monitor-metrics');
        config.setClusterName('client-protocol-monitor-metrics');
        config.getNetworkConfig().setClientProtocolPort(0);
        config.getMonitorConfig()
            .setEnabled(true)
            .setSampleIntervalMs(100);

        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('monitor-metrics-session') as any;
        const serializationService = new SerializationServiceImpl(new SerializationConfig());

        try {
            const key = serializationService.toData('k1')!;
            const value = serializationService.toData('v1')!;
            const queueValue = serializationService.toData('q1')!;

            const putRequest = MapPutCodec.encodeRequest('metrics-map', key, value, 0n, -1n);
            putRequest.setCorrelationId(1);
            putRequest.setPartitionId(0);
            await dispatcher.dispatch(putRequest, session);

            const getRequest = MapGetCodec.encodeRequest('metrics-map', key, 0n);
            getRequest.setCorrelationId(2);
            getRequest.setPartitionId(0);
            await dispatcher.dispatch(getRequest, session);

            const offerRequest = QueueOfferCodec.encodeRequest('metrics-queue', queueValue, 0n);
            offerRequest.setCorrelationId(3);
            offerRequest.setPartitionId(0);
            await dispatcher.dispatch(offerRequest, session);

            const completedCount = await waitForOperationCount(instance, 3);
            expect(completedCount).toBeGreaterThanOrEqual(3);
        } finally {
            serializationService.destroy();
        }
    });

    test('monitor payload counts real HeliosClient socket operations', async () => {
        const clusterName = 'client-protocol-monitor-metrics-socket';
        const config = new HeliosConfig(clusterName);
        config.setClusterName(clusterName);
        config.getNetworkConfig().setClientProtocolPort(0);
        config.getMonitorConfig()
            .setEnabled(true)
            .setSampleIntervalMs(100);

        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);
        await instance.waitForClientProtocolReady();

        const clientConfig = new ClientConfig();
        clientConfig.setClusterName(clusterName);
        clientConfig.setName(`monitor-metrics-client-${Date.now()}`);
        clientConfig.getNetworkConfig().addAddress(`127.0.0.1:${instance.getClientProtocolPort()}`);

        const client = HeliosClient.newHeliosClient(clientConfig);
        clients.push(client);
        await client.connect();

        const map = client.getMap<string, string>('metrics-map');
        const queue = client.getQueue<string>('metrics-queue');

        await map.put('k1', 'v1');
        expect(await map.get('k1')).toBe('v1');
        expect(await queue.offer('q1')).toBeTrue();

        const completedCount = await waitForOperationCount(instance, 3);
        expect(completedCount).toBeGreaterThanOrEqual(3);
    });

    test('monitor payload exposes real queue and topic activity for Management Center', async () => {
        const config = new HeliosConfig('client-protocol-monitor-queue-topic');
        config.setClusterName('client-protocol-monitor-queue-topic');
        config.getMonitorConfig()
            .setEnabled(true)
            .setSampleIntervalMs(100);

        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const queue = instance.getQueue<string>('metrics-queue-activity');
        const topic = instance.getTopic<string>('metrics-topic-activity');
        const received: string[] = [];

        const queueListenerId = queue.addItemListener({
            itemAdded: () => {},
            itemRemoved: () => {},
        });
        const topicListenerId = topic.addMessageListener((message) => {
            received.push(message.getMessageObject());
        });

        try {
            expect(await queue.offer('job-1')).toBeTrue();
            expect(await queue.poll()).toBe('job-1');

            await topic.publish('event-1');
            expect(received).toContain('event-1');

            const { queueStats, topicStats } = await waitForQueueAndTopicStats(instance);
            expect(queueStats).not.toBeNull();
            expect(topicStats).not.toBeNull();
            expect(queueStats!.getOfferOperationCount()).toBeGreaterThanOrEqual(1);
            expect(queueStats!.getPollOperationCount()).toBeGreaterThanOrEqual(1);
            expect(queueStats!.getEventOperationCount()).toBeGreaterThanOrEqual(2);
            expect(topicStats!.getPublishOperationCount()).toBeGreaterThanOrEqual(1);
            expect(topicStats!.getReceiveOperationCount()).toBeGreaterThanOrEqual(1);
        } finally {
            queue.removeItemListener(queueListenerId);
            topic.removeMessageListener(topicListenerId);
        }
    });
});
