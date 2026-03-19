/**
 * Discovery SPI — pluggable discovery strategy interfaces.
 *
 * Third parties implement DiscoveryStrategy + DiscoveryStrategyFactory and
 * register their factory with DiscoveryService to participate in cluster
 * member discovery without modifying core code.
 */

// ---------------------------------------------------------------------------
// DiscoveredNode
// ---------------------------------------------------------------------------

/**
 * Represents a cluster member discovered by a DiscoveryStrategy.
 */
export interface DiscoveredNode {
  /** Network address of the discovered member. */
  readonly address: {
    readonly host: string;
    readonly port: number;
  };
  /** Optional custom metadata attached by the discovery provider. */
  readonly properties?: Map<string, string>;
  /** UUID of the member if already known (e.g. from a registry). */
  readonly memberUuid?: string;
}

// ---------------------------------------------------------------------------
// DiscoveryStrategy
// ---------------------------------------------------------------------------

/**
 * Core SPI interface for a pluggable discovery strategy.
 *
 * Lifecycle: start() → discoverNodes() (repeated) → destroy()
 */
export interface DiscoveryStrategy {
  /**
   * Initialize the strategy — open connections, authenticate, warm up caches.
   * Called once before the first discoverNodes() invocation.
   */
  start(): Promise<void>;

  /**
   * Return the current list of discovered cluster members.
   * May be called repeatedly; implementations should be idempotent.
   */
  discoverNodes(): Promise<DiscoveredNode[]>;

  /**
   * Release all resources held by this strategy.
   * Called once on cluster shutdown.
   */
  destroy(): Promise<void>;

  /**
   * Optional: return the partition-group strategy name understood by the
   * cluster engine (e.g. 'ZONE_AWARE', 'PLACEMENT_AWARE').
   * Return undefined to fall back to cluster default.
   */
  getPartitionGroupStrategy?(): string;
}

// ---------------------------------------------------------------------------
// DiscoveryStrategyConfig
// ---------------------------------------------------------------------------

/**
 * Serialisable configuration blob for a single DiscoveryStrategy.
 * Used in YAML/JSON config files and wired through ConfigLoader.
 */
export interface DiscoveryStrategyConfig {
  /** Factory class name or identifier (e.g. 'aws', 'kubernetes', 'com.example.MyFactory'). */
  readonly className: string;
  /** Arbitrary key/value properties forwarded to the factory. */
  readonly properties: Record<string, string>;
  /** Whether this strategy is active. Disabled strategies are skipped. */
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// DiscoveryStrategyFactory
// ---------------------------------------------------------------------------

/**
 * Factory that creates DiscoveryStrategy instances from a config blob.
 *
 * Register implementations with DiscoveryService.registerFactory() to make
 * them available as first-class discovery mechanisms.
 */
export interface DiscoveryStrategyFactory {
  /**
   * Canonical type identifier for this factory.
   * Must match the `className` field in DiscoveryStrategyConfig.
   * Examples: 'aws', 'kubernetes', 'gcp', 'azure', 'com.example.MyFactory'
   */
  getDiscoveryStrategyType(): string;

  /**
   * Construct a new strategy instance from the supplied config properties.
   * @param config Arbitrary key/value pairs from DiscoveryStrategyConfig.properties.
   */
  newDiscoveryStrategy(config: Record<string, unknown>): DiscoveryStrategy;
}
