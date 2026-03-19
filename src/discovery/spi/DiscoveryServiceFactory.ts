/**
 * DiscoveryServiceFactory — creates a fully-wired DiscoveryService with all
 * built-in provider adapters pre-registered.
 *
 * Third parties can obtain the service and call registerFactory() with their
 * own DiscoveryStrategyFactory implementations before calling start().
 */

import { DiscoveryService } from '@zenystx/helios-core/discovery/spi/DiscoveryService';
import { AwsDiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/adapters/AwsDiscoveryStrategy';
import { AzureDiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/adapters/AzureDiscoveryStrategy';
import { GcpDiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/adapters/GcpDiscoveryStrategy';
import { KubernetesDiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/adapters/KubernetesDiscoveryStrategy';
import { StaticDiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/adapters/StaticDiscoveryStrategy';

/**
 * Build a DiscoveryService with all built-in cloud-provider factories
 * pre-registered. Additional third-party factories can be registered on the
 * returned instance.
 */
export function createDiscoveryService(): DiscoveryService {
  const service = new DiscoveryService();
  service.registerFactory(new StaticDiscoveryStrategyFactory());
  service.registerFactory(new AwsDiscoveryStrategyFactory());
  service.registerFactory(new AzureDiscoveryStrategyFactory());
  service.registerFactory(new GcpDiscoveryStrategyFactory());
  service.registerFactory(new KubernetesDiscoveryStrategyFactory());
  return service;
}
