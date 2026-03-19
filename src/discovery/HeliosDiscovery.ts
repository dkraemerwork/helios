/**
 * HeliosDiscovery — replaces aws/azure/gcp/kubernetes Java discovery packages.
 *
 * Java originals used HttpURLConnection; here we use `fetch()` (Bun built-in).
 * Providers are single-threaded and Promise-based (no thread-pool required).
 *
 * Two operating modes:
 *   Legacy — direct DiscoveryProvider instances, resolved via JoinConfig.
 *   SPI    — DiscoveryService with registered DiscoveryStrategyFactory impls.
 *            Pass a started DiscoveryService to createDiscoveryResolver() to
 *            enable SPI mode; legacy providers are still appended for backward
 *            compatibility.
 */

import type { DiscoveredNode } from '@zenystx/helios-core/discovery/spi/DiscoverySPI';
import type { DiscoveryService } from '@zenystx/helios-core/discovery/spi/DiscoveryService';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MemberAddress {
  readonly host: string;
  readonly port: number;
}

export interface DiscoveryConfig {
  readonly provider: string;
  readonly properties: Readonly<Record<string, string>>;
}

export interface JoinConfig {
  readonly discoveryConfigs: readonly DiscoveryConfig[];
}

export interface DiscoveryProvider {
  readonly name: 'aws' | 'azure' | 'gcp' | 'k8s' | 'static';
  discover(config: DiscoveryConfig, signal?: AbortSignal): Promise<readonly MemberAddress[]>;
}

export interface HeliosDiscoveryResolver {
  resolve(
    joinConfig: JoinConfig,
    providers: readonly DiscoveryProvider[],
    signal?: AbortSignal,
  ): Promise<readonly MemberAddress[]>;
}

/** Options for createDiscoveryResolver(). */
export interface DiscoveryResolverOptions {
  /**
   * Optional SPI DiscoveryService. When provided, its strategies are queried
   * first and their nodes are merged with results from legacy providers.
   * The service must already be started before passing it here.
   */
  discoveryService?: DiscoveryService;
}

// Utility: convert a DiscoveredNode to the flattened MemberAddress.
function discoveredNodeToAddress(node: DiscoveredNode): MemberAddress {
  return { host: node.address.host, port: node.address.port };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 5701;

function parseAddress(raw: string): MemberAddress {
  const trimmed = raw.trim();
  const colonIdx = trimmed.lastIndexOf(':');
  if (colonIdx === -1) {
    return { host: trimmed, port: DEFAULT_PORT };
  }
  const host = trimmed.slice(0, colonIdx);
  const portStr = trimmed.slice(colonIdx + 1);
  const port = parseInt(portStr, 10);
  return { host, port: Number.isNaN(port) ? DEFAULT_PORT : port };
}

// ---------------------------------------------------------------------------
// StaticDiscoveryProvider
// ---------------------------------------------------------------------------

export class StaticDiscoveryProvider implements DiscoveryProvider {
  readonly name = 'static' as const;

  async discover(config: DiscoveryConfig, _signal?: AbortSignal): Promise<readonly MemberAddress[]> {
    const raw = config.properties['addresses'] ?? '';
    if (!raw.trim()) return [];
    return raw.split(',').map(parseAddress);
  }
}

// ---------------------------------------------------------------------------
// AwsDiscoveryProvider
// ---------------------------------------------------------------------------

export class AwsDiscoveryProvider implements DiscoveryProvider {
  readonly name = 'aws' as const;

  async discover(config: DiscoveryConfig, signal?: AbortSignal): Promise<readonly MemberAddress[]> {
    const region = config.properties['region'] ?? 'us-east-1';
    const port = parseInt(config.properties['port'] ?? String(DEFAULT_PORT), 10);
    const url = `https://ec2.${region}.amazonaws.com/?Action=DescribeInstances&Version=2016-11-15`;

    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return [];
      const data = await res.json() as {
        Reservations?: Array<{
          Instances?: Array<{ PrivateIpAddress?: string; State?: { Name?: string } }>;
        }>;
      };
      const members: MemberAddress[] = [];
      for (const reservation of data.Reservations ?? []) {
        for (const inst of reservation.Instances ?? []) {
          if (inst.State?.Name === 'running' && inst.PrivateIpAddress) {
            members.push({ host: inst.PrivateIpAddress, port: Number.isNaN(port) ? DEFAULT_PORT : port });
          }
        }
      }
      return members;
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// AzureDiscoveryProvider
// ---------------------------------------------------------------------------

export class AzureDiscoveryProvider implements DiscoveryProvider {
  readonly name = 'azure' as const;

  async discover(config: DiscoveryConfig, signal?: AbortSignal): Promise<readonly MemberAddress[]> {
    const subscriptionId = config.properties['subscriptionId'] ?? '';
    const resourceGroup = config.properties['resourceGroup'] ?? '';
    const port = parseInt(config.properties['port'] ?? String(DEFAULT_PORT), 10);
    const apiVersion = '2021-03-01';
    const url =
      `https://management.azure.com/subscriptions/${subscriptionId}` +
      `/resourceGroups/${resourceGroup}/providers/Microsoft.Compute` +
      `/virtualMachineScaleSets?api-version=${apiVersion}`;

    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return [];
      const data = await res.json() as {
        value?: Array<{ properties?: { privateIPAddress?: string } }>;
      };
      return (data.value ?? [])
        .map(vm => vm.properties?.privateIPAddress)
        .filter((ip): ip is string => !!ip)
        .map(host => ({ host, port: Number.isNaN(port) ? DEFAULT_PORT : port }));
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// GcpDiscoveryProvider
// ---------------------------------------------------------------------------

export class GcpDiscoveryProvider implements DiscoveryProvider {
  readonly name = 'gcp' as const;

  async discover(config: DiscoveryConfig, signal?: AbortSignal): Promise<readonly MemberAddress[]> {
    const project = config.properties['project'] ?? '';
    const zone = config.properties['zone'] ?? '-';
    const port = parseInt(config.properties['port'] ?? String(DEFAULT_PORT), 10);
    const url =
      `https://compute.googleapis.com/compute/v1/projects/${project}/zones/${zone}/instances`;

    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return [];
      const data = await res.json() as {
        items?: Array<{ networkInterfaces?: Array<{ networkIP?: string }> }>;
      };
      return (data.items ?? [])
        .map(inst => inst.networkInterfaces?.[0]?.networkIP)
        .filter((ip): ip is string => !!ip)
        .map(host => ({ host, port: Number.isNaN(port) ? DEFAULT_PORT : port }));
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// K8sDiscoveryProvider
// ---------------------------------------------------------------------------

export class K8sDiscoveryProvider implements DiscoveryProvider {
  readonly name = 'k8s' as const;

  async discover(config: DiscoveryConfig, signal?: AbortSignal): Promise<readonly MemberAddress[]> {
    const namespace = config.properties['namespace'] ?? 'default';
    const serviceName = config.properties['serviceName'] ?? 'helios';
    const port = parseInt(config.properties['port'] ?? String(DEFAULT_PORT), 10);

    const apiHost =
      process.env['KUBERNETES_SERVICE_HOST'] ?? 'kubernetes.default.svc';
    const apiPort = process.env['KUBERNETES_SERVICE_PORT'] ?? '443';
    const url =
      `https://${apiHost}:${apiPort}/api/v1/namespaces/${namespace}/endpoints/${serviceName}`;

    const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
    let token = '';
    try {
      token = await Bun.file(tokenPath).text();
    } catch {
      // not running inside a pod — token unavailable
    }

    try {
      const res = await fetch(url, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      const data = await res.json() as {
        subsets?: Array<{ addresses?: Array<{ ip?: string }> }>;
      };
      const members: MemberAddress[] = [];
      for (const subset of data.subsets ?? []) {
        for (const addr of subset.addresses ?? []) {
          if (addr.ip) {
            members.push({ host: addr.ip, port: Number.isNaN(port) ? DEFAULT_PORT : port });
          }
        }
      }
      return members;
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// HeliosDiscoveryResolver factory
// ---------------------------------------------------------------------------

class DefaultHeliosDiscoveryResolver implements HeliosDiscoveryResolver {
  constructor(
    private readonly _builtinProviders: readonly DiscoveryProvider[],
    private readonly _discoveryService?: DiscoveryService,
  ) {}

  async resolve(
    joinConfig: JoinConfig,
    providers: readonly DiscoveryProvider[],
    signal?: AbortSignal,
  ): Promise<readonly MemberAddress[]> {
    const seen = new Set<string>();
    const results: MemberAddress[] = [];

    const add = (addr: MemberAddress): void => {
      const key = `${addr.host}:${addr.port}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(addr);
      }
    };

    // SPI mode: query the DiscoveryService first.
    if (this._discoveryService) {
      const nodes = await this._discoveryService.discoverNodes();
      for (const node of nodes) {
        add(discoveredNodeToAddress(node));
      }
    }

    // Legacy mode: query direct DiscoveryProvider instances.
    const allProviders = [...this._builtinProviders, ...providers];
    for (const dc of joinConfig.discoveryConfigs) {
      const provider = allProviders.find(p => p.name === dc.provider);
      if (!provider) continue;
      const members = await provider.discover(dc, signal);
      for (const m of members) {
        add(m);
      }
    }

    return results;
  }
}

/**
 * Create a HeliosDiscoveryResolver.
 *
 * @param providers   Additional DiscoveryProvider instances (legacy mode).
 * @param options     Optional SPI options, including a started DiscoveryService.
 */
export function createDiscoveryResolver(
  providers: readonly DiscoveryProvider[] = [],
  options: DiscoveryResolverOptions = {},
): HeliosDiscoveryResolver {
  return new DefaultHeliosDiscoveryResolver(providers, options.discoveryService);
}
