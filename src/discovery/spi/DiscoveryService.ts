/**
 * DiscoveryService — orchestrates multiple DiscoveryStrategy instances.
 *
 * Maintains a registry of DiscoveryStrategyFactory implementations and
 * manages the full lifecycle (start → discoverNodes → destroy) of all
 * configured strategies.
 */

import type {
  DiscoveredNode,
  DiscoveryStrategy,
  DiscoveryStrategyConfig,
  DiscoveryStrategyFactory,
} from '@zenystx/helios-core/discovery/spi/DiscoverySPI';

export class DiscoveryService {
  private readonly _factories = new Map<string, DiscoveryStrategyFactory>();
  private readonly _strategies: DiscoveryStrategy[] = [];
  private _started = false;

  // -------------------------------------------------------------------------
  // Factory registry
  // -------------------------------------------------------------------------

  /**
   * Register a factory so that strategies of its type can be instantiated
   * from config. Call this before start().
   */
  registerFactory(factory: DiscoveryStrategyFactory): void {
    this._factories.set(factory.getDiscoveryStrategyType(), factory);
  }

  /**
   * Instantiate strategies from a list of configs and add them to the
   * internal list. Disabled entries are silently ignored.
   * Call this before start().
   */
  addStrategiesFromConfig(configs: readonly DiscoveryStrategyConfig[]): void {
    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      const factory = this._factories.get(cfg.className);
      if (!factory) {
        throw new Error(
          `No DiscoveryStrategyFactory registered for type "${cfg.className}". ` +
          `Registered types: [${[...this._factories.keys()].join(', ')}]`,
        );
      }
      this._strategies.push(factory.newDiscoveryStrategy(cfg.properties));
    }
  }

  /**
   * Directly add a pre-constructed strategy (useful in tests or programmatic
   * setup where a config file is not used).
   */
  addStrategy(strategy: DiscoveryStrategy): void {
    this._strategies.push(strategy);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start all registered strategies concurrently.
   */
  async start(): Promise<void> {
    if (this._started) return;
    await Promise.all(this._strategies.map(s => s.start()));
    this._started = true;
  }

  /**
   * Aggregate discovered nodes from all active strategies.
   * Duplicate addresses (same host:port) are deduplicated; the first
   * occurrence (by strategy registration order) wins.
   */
  async discoverNodes(): Promise<DiscoveredNode[]> {
    const batches = await Promise.all(this._strategies.map(s => s.discoverNodes()));
    const seen = new Set<string>();
    const result: DiscoveredNode[] = [];

    for (const batch of batches) {
      for (const node of batch) {
        const key = `${node.address.host}:${node.address.port}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(node);
        }
      }
    }

    return result;
  }

  /**
   * Destroy all strategies concurrently, ignoring individual failures so
   * that all strategies get a chance to clean up.
   */
  async destroy(): Promise<void> {
    await Promise.allSettled(this._strategies.map(s => s.destroy()));
    this._strategies.length = 0;
    this._started = false;
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /** Number of active strategies. */
  get strategyCount(): number {
    return this._strategies.length;
  }

  /** Names of all registered factory types. */
  get registeredFactoryTypes(): string[] {
    return [...this._factories.keys()];
  }
}
