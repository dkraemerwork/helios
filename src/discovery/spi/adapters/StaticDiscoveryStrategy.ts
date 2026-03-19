/**
 * StaticDiscoveryStrategy — wraps StaticDiscoveryProvider as a DiscoveryStrategy.
 *
 * Accepted config properties:
 *   addresses — comma-separated list of host[:port] entries
 *               e.g. "10.0.0.1:5701,10.0.0.2,10.0.0.3:5702"
 */

import { StaticDiscoveryProvider } from '@zenystx/helios-core/discovery/HeliosDiscovery';
import type { DiscoveredNode, DiscoveryStrategy, DiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/DiscoverySPI';

export class StaticDiscoveryStrategy implements DiscoveryStrategy {
  private readonly _provider = new StaticDiscoveryProvider();
  private readonly _config: Record<string, string>;

  constructor(config: Record<string, string>) {
    this._config = config;
  }

  async start(): Promise<void> {
    // Static addresses — nothing to initialize.
  }

  async discoverNodes(): Promise<DiscoveredNode[]> {
    const members = await this._provider.discover({
      provider: 'static',
      properties: this._config,
    });
    return members.map(m => ({
      address: { host: m.host, port: m.port },
    }));
  }

  async destroy(): Promise<void> {
    // No resources to release.
  }
}

export class StaticDiscoveryStrategyFactory implements DiscoveryStrategyFactory {
  getDiscoveryStrategyType(): string {
    return 'static';
  }

  newDiscoveryStrategy(config: Record<string, unknown>): DiscoveryStrategy {
    const stringConfig: Record<string, string> = {};
    for (const [k, v] of Object.entries(config)) {
      stringConfig[k] = String(v);
    }
    return new StaticDiscoveryStrategy(stringConfig);
  }
}
