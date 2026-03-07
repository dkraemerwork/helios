/**
 * Client-side proxy manager.
 *
 * Port of {@code com.hazelcast.client.impl.spi.ProxyManager}.
 *
 * Owns creation, caching, and destruction of all client proxy instances.
 * Proxies are keyed by (serviceName, objectName) and cached for stable
 * instance identity until explicitly destroyed or the client shuts down.
 *
 * When a {@link ClientConfig} with near-cache entries is provided, the MAP
 * factory will create {@link NearCachedClientMapProxy} instances for maps
 * whose names match a registered {@link NearCacheConfig} pattern.
 */
import type { ClientInvocationService } from "@zenystx/helios-core/client/invocation/ClientInvocationService";
import type { ClientPartitionService } from "@zenystx/helios-core/client/spi/ClientPartitionService";
import type { SerializationServiceImpl } from "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import { ClientProxy } from "@zenystx/helios-core/client/proxy/ClientProxy";
import { ClientMapProxy } from "@zenystx/helios-core/client/proxy/ClientMapProxy";
import { ClientQueueProxy } from "@zenystx/helios-core/client/proxy/ClientQueueProxy";
import { ClientTopicProxy } from "@zenystx/helios-core/client/proxy/ClientTopicProxy";
import { NearCachedClientMapProxy } from "@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy";
import type { ClientNearCacheManager } from "@zenystx/helios-core/client/impl/nearcache/ClientNearCacheManager";
import type { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";
import { ClientListenerService } from "@zenystx/helios-core/client/spi/ClientListenerService";

const MAP_SERVICE = "hz:impl:mapService";
const QUEUE_SERVICE = "hz:impl:queueService";
const TOPIC_SERVICE = "hz:impl:topicService";

type ProxyFactory = (name: string) => ClientProxy;

export class ProxyManager {
    private readonly _serializationService: SerializationServiceImpl;
    private readonly _partitionService: ClientPartitionService;
    private _invocationService: ClientInvocationService | null;
    private readonly _proxies = new Map<string, ClientProxy>();
    private readonly _factories = new Map<string, ProxyFactory>();
    private _nearCacheManager: ClientNearCacheManager | null = null;
    private _clientConfig: ClientConfig | null = null;
    private readonly _listenerService: ClientListenerService;

    constructor(
        serializationService: SerializationServiceImpl,
        partitionService: ClientPartitionService,
        invocationService: ClientInvocationService | null,
    ) {
        this._serializationService = serializationService;
        this._partitionService = partitionService;
        this._invocationService = invocationService;
        this._listenerService = new ClientListenerService();

        this._registerDefaults();
    }

    getNearCacheManager(): ClientNearCacheManager | null {
        return this._nearCacheManager;
    }

    setNearCacheManager(manager: ClientNearCacheManager): void {
        this._nearCacheManager = manager;
    }

    setClientConfig(config: ClientConfig): void {
        this._clientConfig = config;
    }

    setInvocationService(svc: ClientInvocationService): void {
        this._invocationService = svc;
        this._listenerService.setInvocationService(svc);
        this._listenerService.reconnectListeners();
    }

    getListenerService(): ClientListenerService {
        return this._listenerService;
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
        proxy.setListenerService(this._listenerService);
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
        // Clean up near-cache if present
        if (this._nearCacheManager) {
            this._nearCacheManager.destroyNearCache(name);
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
        this._factories.set(MAP_SERVICE, (name) => {
            const ncConfig = this._clientConfig?.getNearCacheConfig(name) ?? null;
            if (ncConfig !== null && this._nearCacheManager !== null) {
                const nearCache = this._nearCacheManager.getOrCreateNearCache(name, ncConfig);
                return new NearCachedClientMapProxy(
                    name, MAP_SERVICE, this._serializationService,
                    this._invocationService, this._partitionService, nearCache,
                );
            }
            return new ClientMapProxy(
                name, MAP_SERVICE, this._serializationService,
                this._invocationService, this._partitionService,
            );
        });

        this._factories.set(QUEUE_SERVICE, (name) =>
            new ClientQueueProxy(name, QUEUE_SERVICE, this._serializationService, this._invocationService, this._partitionService));

        this._factories.set(TOPIC_SERVICE, (name) =>
            new ClientTopicProxy(name, TOPIC_SERVICE, this._serializationService, this._invocationService, this._partitionService));
    }
}
