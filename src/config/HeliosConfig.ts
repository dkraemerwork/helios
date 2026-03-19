/**
 * Top-level configuration for a Helios instance.
 *
 * Holds the instance name and any per-map configurations.
 * Use HeliosConfig as the entry point when constructing a HeliosInstanceImpl.
 */
import { BackpressureConfig } from "@zenystx/helios-core/config/BackpressureConfig.js";
import type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig.js";
import { ExecutorConfig } from "@zenystx/helios-core/config/ExecutorConfig.js";
import { DEFAULT_CLUSTER_NAME } from "@zenystx/helios-core/config/HazelcastDefaults.js";
import { MapConfig } from "@zenystx/helios-core/config/MapConfig.js";
import { MonitorConfig } from "@zenystx/helios-core/config/MonitorConfig.js";
import { NetworkConfig } from "@zenystx/helios-core/config/NetworkConfig.js";
import { PersistenceConfig } from "@zenystx/helios-core/config/PersistenceConfig.js";
import { QueueConfig } from "@zenystx/helios-core/config/QueueConfig.js";
import { ReliableTopicConfig } from "@zenystx/helios-core/config/ReliableTopicConfig.js";
import { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig.js";
import { ScheduledExecutorConfig } from "@zenystx/helios-core/config/ScheduledExecutorConfig.js";
import { SplitBrainProtectionConfig } from "@zenystx/helios-core/config/SplitBrainProtectionConfig.js";
import { TopicConfig } from "@zenystx/helios-core/config/TopicConfig.js";
import type { InstanceConfig } from "@zenystx/helios-core/core/InstanceConfig.js";
import { HazelcastSerializationConfig } from '@zenystx/helios-core/internal/serialization/HazelcastSerializationService.js';
import { MapStoreProviderRegistry } from "@zenystx/helios-core/map/impl/mapstore/MapStoreProviderRegistry.js";
import type { MapStoreFactory } from "@zenystx/helios-core/map/MapStoreFactory.js";
import { CPSubsystemConfig } from '@zenystx/helios-core/config/CPSubsystemConfig.js';
import type { WanReplicationConfig } from '@zenystx/helios-core/config/WanReplicationConfig.js';

export class HeliosConfig implements InstanceConfig {
  private readonly _name: string;
  private _clusterName: string = DEFAULT_CLUSTER_NAME;
  private readonly _mapConfigs = new Map<string, MapConfig>();
  private readonly _queueConfigs = new Map<string, QueueConfig>();
  private readonly _topicConfigs = new Map<string, TopicConfig>();
  private readonly _executorConfigs = new Map<string, ExecutorConfig>();
  private readonly _reliableTopicConfigs = new Map<string, ReliableTopicConfig>();
  private readonly _ringbufferConfigs = new Map<string, RingbufferConfig>();
  private readonly _scheduledExecutorConfigs = new Map<string, ScheduledExecutorConfig>();
  private readonly _splitBrainProtectionConfigs = new Map<string, SplitBrainProtectionConfig>();
  private readonly _network: NetworkConfig = new NetworkConfig();
  private readonly _mapStoreProviderRegistry = new MapStoreProviderRegistry();
  private readonly _monitorConfig = new MonitorConfig();
  private readonly _backpressureConfig = new BackpressureConfig();
  private _persistenceConfig = new PersistenceConfig();
  private readonly _serializationConfig = new HazelcastSerializationConfig();
  private _blitzConfig: HeliosBlitzRuntimeConfig | null = null;
  private _configOrigin: string | null = null;
  private _cpSubsystemConfig = new CPSubsystemConfig();
  private readonly _wanReplicationConfigs = new Map<string, WanReplicationConfig>();

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
   * Returns the cluster group name used for member discovery.
   * Defaults to {@code "dev"} — the Hazelcast OSS default.
   *
   * @source {@code com.hazelcast.config.Config.DEFAULT_CLUSTER_NAME}
   */
  getClusterName(): string {
    return this._clusterName;
  }

  setClusterName(clusterName: string): this {
    if (!clusterName || clusterName.trim() === "") {
      throw new Error("clusterName must be a non-empty string");
    }
    this._clusterName = clusterName;
    return this;
  }

  /**
   * Returns the network configuration (port, join strategy, etc.).
   */
  getNetworkConfig(): NetworkConfig {
    return this._network;
  }

  /**
   * Returns the monitoring configuration.
   * Monitoring is opt-in: call `getMonitorConfig().setEnabled(true)` to activate.
   */
  getMonitorConfig(): MonitorConfig {
    return this._monitorConfig;
  }

  /**
   * Returns the backpressure configuration for remote invocation admission control.
   * Backpressure is enabled by default; call `getBackpressureConfig().setEnabled(false)` to disable.
   */
  getBackpressureConfig(): BackpressureConfig {
    return this._backpressureConfig;
  }

  getSerializationConfig(): HazelcastSerializationConfig {
    return this._serializationConfig;
  }

  /**
   * Returns the persistence configuration for WAL-based Hot Restart.
   * Persistence is opt-in: call `getPersistenceConfig().setEnabled(true)` to activate.
   */
  getPersistenceConfig(): PersistenceConfig {
    return this._persistenceConfig;
  }

  setPersistenceConfig(config: PersistenceConfig): this {
    this._persistenceConfig = config;
    return this;
  }

  /**
   * Returns the CP Subsystem configuration.
   * CP Subsystem provides linearizable distributed data structures
   * using the Raft consensus algorithm.
   */
  getCpSubsystemConfig(): CPSubsystemConfig { return this._cpSubsystemConfig; }

  setCpSubsystemConfig(config: CPSubsystemConfig): this {
    this._cpSubsystemConfig = config;
    return this;
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

  addScheduledExecutorConfig(config: ScheduledExecutorConfig): this {
    this._scheduledExecutorConfigs.set(config.getName(), config);
    return this;
  }

  getScheduledExecutorConfig(name: string): ScheduledExecutorConfig {
    return this._scheduledExecutorConfigs.get(name) ?? new ScheduledExecutorConfig(name);
  }

  findScheduledExecutorConfig(name: string): ScheduledExecutorConfig | null {
    return this._scheduledExecutorConfigs.get(name) ?? null;
  }

  getScheduledExecutorConfigs(): ReadonlyMap<string, ScheduledExecutorConfig> {
    return this._scheduledExecutorConfigs;
  }

  /**
   * Register a named SplitBrainProtectionConfig.
   *
   * Referenced by data-structure configs (e.g. MapConfig.setSplitBrainProtectionName())
   * to enforce quorum before operations execute.
   */
  addSplitBrainProtectionConfig(config: SplitBrainProtectionConfig): this {
    this._splitBrainProtectionConfigs.set(config.getName(), config);
    return this;
  }

  /**
   * Returns the SplitBrainProtectionConfig with the given name, or null if not registered.
   */
  getSplitBrainProtectionConfig(name: string): SplitBrainProtectionConfig | null {
    return this._splitBrainProtectionConfigs.get(name) ?? null;
  }

  /**
   * Returns all registered SplitBrainProtectionConfigs.
   */
  getSplitBrainProtectionConfigs(): ReadonlyMap<string, SplitBrainProtectionConfig> {
    return this._splitBrainProtectionConfigs;
  }

  getBlitzConfig(): HeliosBlitzRuntimeConfig | null {
    return this._blitzConfig;
  }

  setBlitzConfig(config: HeliosBlitzRuntimeConfig): this {
    this._blitzConfig = config;
    return this;
  }

  /**
   * Register a WanReplicationConfig. The config's name is used as the lookup key.
   * Throws if the WanReplicationConfig has no name set.
   */
  addWanReplicationConfig(config: WanReplicationConfig): this {
    const name = config.getName();
    if (!name || name.trim() === '') {
      throw new Error('WanReplicationConfig must have a non-empty name when added to HeliosConfig');
    }
    this._wanReplicationConfigs.set(name, config);
    return this;
  }

  /**
   * Returns the WanReplicationConfig registered with the given name, or null.
   */
  getWanReplicationConfig(name: string): WanReplicationConfig | null {
    return this._wanReplicationConfigs.get(name) ?? null;
  }

  /**
   * Returns all registered WanReplicationConfigs.
   */
  getWanReplicationConfigs(): ReadonlyMap<string, WanReplicationConfig> {
    return this._wanReplicationConfigs;
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
