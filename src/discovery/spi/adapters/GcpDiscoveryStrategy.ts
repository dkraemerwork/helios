/**
 * GcpDiscoveryStrategy — wraps GcpDiscoveryProvider as a DiscoveryStrategy.
 *
 * Accepted config properties:
 *   project — GCP project ID
 *   zone    — Compute zone or '-' for all zones (default: '-')
 *   port    — Helios member port (default: 5701)
 */

import { GcpDiscoveryProvider } from '@zenystx/helios-core/discovery/HeliosDiscovery';
import type { DiscoveredNode, DiscoveryStrategy, DiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/DiscoverySPI';

export class GcpDiscoveryStrategy implements DiscoveryStrategy {
  private readonly _provider = new GcpDiscoveryProvider();
  private readonly _config: Record<string, string>;

  constructor(config: Record<string, string>) {
    this._config = config;
  }

  async start(): Promise<void> {
    // No persistent connection required.
  }

  async discoverNodes(): Promise<DiscoveredNode[]> {
    const members = await this._provider.discover({
      provider: 'gcp',
      properties: this._config,
    });
    return members.map(m => ({
      address: { host: m.host, port: m.port },
      properties: new Map(Object.entries(this._config)),
    }));
  }

  async destroy(): Promise<void> {
    // No resources to release.
  }

  getPartitionGroupStrategy(): string {
    return 'ZONE_AWARE';
  }
}

export class GcpDiscoveryStrategyFactory implements DiscoveryStrategyFactory {
  getDiscoveryStrategyType(): string {
    return 'gcp';
  }

  newDiscoveryStrategy(config: Record<string, unknown>): DiscoveryStrategy {
    const stringConfig: Record<string, string> = {};
    for (const [k, v] of Object.entries(config)) {
      stringConfig[k] = String(v);
    }
    return new GcpDiscoveryStrategy(stringConfig);
  }
}
