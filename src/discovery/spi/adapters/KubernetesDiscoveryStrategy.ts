/**
 * KubernetesDiscoveryStrategy — wraps K8sDiscoveryProvider as a DiscoveryStrategy.
 *
 * Accepted config properties:
 *   namespace   — Kubernetes namespace (default: 'default')
 *   serviceName — Service name to query endpoints for (default: 'helios')
 *   port        — Helios member port (default: 5701)
 */

import { K8sDiscoveryProvider } from '@zenystx/helios-core/discovery/HeliosDiscovery';
import type { DiscoveredNode, DiscoveryStrategy, DiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/DiscoverySPI';

export class KubernetesDiscoveryStrategy implements DiscoveryStrategy {
  private readonly _provider = new K8sDiscoveryProvider();
  private readonly _config: Record<string, string>;

  constructor(config: Record<string, string>) {
    this._config = config;
  }

  async start(): Promise<void> {
    // Token is read lazily per-call inside the provider.
  }

  async discoverNodes(): Promise<DiscoveredNode[]> {
    const members = await this._provider.discover({
      provider: 'k8s',
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

export class KubernetesDiscoveryStrategyFactory implements DiscoveryStrategyFactory {
  getDiscoveryStrategyType(): string {
    return 'kubernetes';
  }

  newDiscoveryStrategy(config: Record<string, unknown>): DiscoveryStrategy {
    const stringConfig: Record<string, string> = {};
    for (const [k, v] of Object.entries(config)) {
      stringConfig[k] = String(v);
    }
    return new KubernetesDiscoveryStrategy(stringConfig);
  }
}
