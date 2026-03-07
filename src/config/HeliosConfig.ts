/**
 * Top-level configuration for a Helios instance.
 *
 * Holds the instance name and any per-map configurations.
 * Use HeliosConfig as the entry point when constructing a HeliosInstanceImpl.
 */
import type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig";
import { ExecutorConfig } from "@zenystx/helios-core/config/ExecutorConfig";
import { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import { NetworkConfig } from "@zenystx/helios-core/config/NetworkConfig";
import { QueueConfig } from "@zenystx/helios-core/config/QueueConfig";
import { TopicConfig } from "@zenystx/helios-core/config/TopicConfig";
import { ReliableTopicConfig } from "@zenystx/helios-core/config/ReliableTopicConfig";
import { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
import { MapStoreProviderRegistry } from "@zenystx/helios-core/map/impl/mapstore/MapStoreProviderRegistry";
import type { MapStoreFactory } from "@zenystx/helios-core/map/MapStoreFactory";

export class HeliosConfig {
  private readonly _name: string;
  private readonly _mapConfigs = new Map<string, MapConfig>();
  private readonly _queueConfigs = new Map<string, QueueConfig>();
  private readonly _topicConfigs = new Map<string, TopicConfig>();
  private readonly _executorConfigs = new Map<string, ExecutorConfig>();
  private readonly _reliableTopicConfigs = new Map<string, ReliableTopicConfig>();
  private readonly _ringbufferConfigs = new Map<string, RingbufferConfig>();
  private readonly _network: NetworkConfig = new NetworkConfig();
  private readonly _mapStoreProviderRegistry = new MapStoreProviderRegistry();
  private _blitzConfig: HeliosBlitzRuntimeConfig | null = null;
  private _configOrigin: string | null = null;

  constructor(name?: string) {
    this._name = name ?? "helios";
  }

  getConfigOrigin(): string | null {
    return this._configOrigin;
  }

  setConfigOrigin(origin: string | null): this {
    this._configOrigin = origin;
    return this;
  }

  getName(): string {
    return this._name;
  }

  /**
   * Returns the network configuration (port, join strategy, etc.).
   */
  getNetworkConfig(): NetworkConfig {
    return this._network;
  }

  /**
   * Register a MapConfig. The config's name (from MapConfig.getName()) is used
   * as the lookup key. Throws if the MapConfig has no name set.
   */
  addMapConfig(mapConfig: MapConfig): this {
    const name = mapConfig.getName();
    if (name == null) {
      throw new Error("MapConfig must have a name when added to HeliosConfig");
    }
    this._mapConfigs.set(name, mapConfig);
    return this;
  }

  /**
   * Returns the MapConfig registered for the given map name, or null.
   */
  getMapConfig(name: string): MapConfig | null {
    return this._mapConfigs.get(name) ?? null;
  }

  /**
   * Returns all registered MapConfigs.
   */
  getMapConfigs(): ReadonlyMap<string, MapConfig> {
    return this._mapConfigs;
  }

  addQueueConfig(queueConfig: QueueConfig): this {
    this._queueConfigs.set(queueConfig.getName(), queueConfig);
    return this;
  }

  getQueueConfig(name: string): QueueConfig {
    return this._queueConfigs.get(name) ?? new QueueConfig(name);
  }

  getQueueConfigs(): ReadonlyMap<string, QueueConfig> {
    return this._queueConfigs;
  }

  addTopicConfig(topicConfig: TopicConfig): this {
    this._topicConfigs.set(topicConfig.getName(), topicConfig);
    return this;
  }

  getTopicConfig(name: string): TopicConfig {
    return this._topicConfigs.get(name) ?? new TopicConfig(name);
  }

  getTopicConfigs(): ReadonlyMap<string, TopicConfig> {
    return this._topicConfigs;
  }

  addReliableTopicConfig(config: ReliableTopicConfig): this {
    this._reliableTopicConfigs.set(config.getName(), config);
    return this;
  }

  getReliableTopicConfig(name: string): ReliableTopicConfig {
    return this._reliableTopicConfigs.get(name) ?? new ReliableTopicConfig(name);
  }

  getReliableTopicConfigs(): ReadonlyMap<string, ReliableTopicConfig> {
    return this._reliableTopicConfigs;
  }

  addRingbufferConfig(config: RingbufferConfig): this {
    this._ringbufferConfigs.set(config.getName(), config);
    return this;
  }

  getRingbufferConfig(name: string): RingbufferConfig {
    return this._ringbufferConfigs.get(name) ?? new RingbufferConfig(name);
  }

  getRingbufferConfigs(): ReadonlyMap<string, RingbufferConfig> {
    return this._ringbufferConfigs;
  }

  addExecutorConfig(executorConfig: ExecutorConfig): this {
    this._executorConfigs.set(executorConfig.getName(), executorConfig);
    return this;
  }

  /**
   * Returns the ExecutorConfig for the given name. If none is registered,
   * returns a new default ExecutorConfig with that name (fallback behavior).
   */
  getExecutorConfig(name: string): ExecutorConfig {
    return this._executorConfigs.get(name) ?? new ExecutorConfig(name);
  }

  getExecutorConfigs(): ReadonlyMap<string, ExecutorConfig> {
    return this._executorConfigs;
  }

  getBlitzConfig(): HeliosBlitzRuntimeConfig | null {
    return this._blitzConfig;
  }

  setBlitzConfig(config: HeliosBlitzRuntimeConfig): this {
    this._blitzConfig = config;
    return this;
  }

  registerMapStoreProvider(name: string, factory: MapStoreFactory<unknown, unknown>): this {
    this._mapStoreProviderRegistry.register(name, factory);
    return this;
  }

  getMapStoreProvider(name: string): MapStoreFactory<unknown, unknown> | null {
    return this._mapStoreProviderRegistry.get(name);
  }

  getMapStoreProviderRegistry(): MapStoreProviderRegistry {
    return this._mapStoreProviderRegistry;
  }
}
