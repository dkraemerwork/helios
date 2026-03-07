/**
 * Client-side proxy manager.
 *
 * Port of {@code com.hazelcast.client.impl.spi.ProxyManager}.
 *
 * Owns creation, caching, and destruction of all client proxy instances.
 * Proxies are keyed by (serviceName, objectName) and cached for stable
 * instance identity until explicitly destroyed or the client shuts down.
 */
import type { ClientInvocationService } from "@zenystx/helios-core/client/invocation/ClientInvocationService";
import type { ClientPartitionService } from "@zenystx/helios-core/client/spi/ClientPartitionService";
import type { SerializationServiceImpl } from "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import { ClientProxy } from "@zenystx/helios-core/client/proxy/ClientProxy";
import { ClientMapProxy } from "@zenystx/helios-core/client/proxy/ClientMapProxy";
import { ClientQueueProxy } from "@zenystx/helios-core/client/proxy/ClientQueueProxy";
import { ClientTopicProxy } from "@zenystx/helios-core/client/proxy/ClientTopicProxy";
import { ClientReliableTopicProxy } from "@zenystx/helios-core/client/proxy/ClientReliableTopicProxy";
import { ClientExecutorProxy } from "@zenystx/helios-core/client/proxy/ClientExecutorProxy";

const MAP_SERVICE = "hz:impl:mapService";
const QUEUE_SERVICE = "hz:impl:queueService";
const TOPIC_SERVICE = "hz:impl:topicService";
const RELIABLE_TOPIC_SERVICE = "hz:impl:reliableTopicService";
const EXECUTOR_SERVICE = "hz:impl:executorService";

type ProxyFactory = (name: string) => ClientProxy;

export class ProxyManager {
    private readonly _serializationService: SerializationServiceImpl;
    private readonly _partitionService: ClientPartitionService;
    private readonly _invocationService: ClientInvocationService | null;
    private readonly _proxies = new Map<string, ClientProxy>();
    private readonly _factories = new Map<string, ProxyFactory>();

    constructor(
        serializationService: SerializationServiceImpl,
        partitionService: ClientPartitionService,
        invocationService: ClientInvocationService | null,
    ) {
        this._serializationService = serializationService;
        this._partitionService = partitionService;
        this._invocationService = invocationService;

        this._registerDefaults();
    }

    getOrCreateProxy(serviceName: string, name: string): ClientProxy {
        const key = `${serviceName}:${name}`;
        const existing = this._proxies.get(key);
        if (existing && !existing.isDestroyed()) {
            return existing;
        }

        const factory = this._factories.get(serviceName);
        if (!factory) {
            throw new Error(`No proxy factory registered for service: ${serviceName}`);
        }

        const proxy = factory(name);
        this._proxies.set(key, proxy);
        return proxy;
    }

    async destroyProxy(serviceName: string, name: string): Promise<void> {
        const key = `${serviceName}:${name}`;
        const proxy = this._proxies.get(key);
        if (proxy) {
            this._proxies.delete(key);
            await proxy.destroy();
        }
    }

    destroyAll(): void {
        for (const proxy of this._proxies.values()) {
            proxy.destroy().catch(() => {});
        }
        this._proxies.clear();
    }

    getDistributedObjects(): DistributedObject[] {
        return [...this._proxies.values()].filter(p => !p.isDestroyed());
    }

    private _registerDefaults(): void {
        this._factories.set(MAP_SERVICE, (name) =>
            new ClientMapProxy(name, MAP_SERVICE, this._serializationService, this._invocationService, this._partitionService));

        this._factories.set(QUEUE_SERVICE, (name) =>
            new ClientQueueProxy(name, QUEUE_SERVICE, this._serializationService, this._invocationService, this._partitionService));

        this._factories.set(TOPIC_SERVICE, (name) =>
            new ClientTopicProxy(name, TOPIC_SERVICE, this._serializationService, this._invocationService, this._partitionService));

        this._factories.set(RELIABLE_TOPIC_SERVICE, (name) =>
            new ClientReliableTopicProxy(name, RELIABLE_TOPIC_SERVICE, this._serializationService, this._invocationService, this._partitionService));

        this._factories.set(EXECUTOR_SERVICE, (name) =>
            new ClientExecutorProxy(name, EXECUTOR_SERVICE, this._serializationService, this._invocationService, this._partitionService));
    }
}
