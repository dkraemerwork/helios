import {
  AwsDiscoveryProvider,
  AzureDiscoveryProvider,
  DiscoveryConfig,
  GcpDiscoveryProvider,
  JoinConfig,
  K8sDiscoveryProvider,
  StaticDiscoveryProvider,
  createDiscoveryResolver
} from '@zenystx/helios-core/discovery/HeliosDiscovery';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(provider: string, extra: Record<string, string> = {}): DiscoveryConfig {
  return { provider, properties: extra };
}

function makeJoinConfig(providers: DiscoveryConfig[]): JoinConfig {
  return { discoveryConfigs: providers };
}

// ---------------------------------------------------------------------------
// StaticDiscoveryProvider
// ---------------------------------------------------------------------------

describe('StaticDiscoveryProvider', () => {
  test('returns addresses from config properties', async () => {
    const provider = new StaticDiscoveryProvider();
    const config = makeConfig('static', { addresses: '10.0.0.1:5701,10.0.0.2:5701' });
    const members = await provider.discover(config);
    expect(members).toHaveLength(2);
    expect(members[0]).toEqual({ host: '10.0.0.1', port: 5701 });
    expect(members[1]).toEqual({ host: '10.0.0.2', port: 5701 });
  });

  test('returns empty array when no addresses configured', async () => {
    const provider = new StaticDiscoveryProvider();
    const config = makeConfig('static', {});
    const members = await provider.discover(config);
    expect(members).toHaveLength(0);
  });

  test('uses default port 5701 when port not specified', async () => {
    const provider = new StaticDiscoveryProvider();
    const config = makeConfig('static', { addresses: '192.168.1.10' });
    const members = await provider.discover(config);
    expect(members).toHaveLength(1);
    expect(members[0]).toEqual({ host: '192.168.1.10', port: 5701 });
  });
});

// ---------------------------------------------------------------------------
// AwsDiscoveryProvider
// ---------------------------------------------------------------------------

describe('AwsDiscoveryProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('discovers members from AWS EC2 describe-instances response', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        Reservations: [
          {
            Instances: [
              { PrivateIpAddress: '10.0.1.1', State: { Name: 'running' } },
              { PrivateIpAddress: '10.0.1.2', State: { Name: 'running' } },
            ],
          },
        ],
      }),
    };
    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response)) as unknown as typeof fetch;

    const provider = new AwsDiscoveryProvider();
    const config = makeConfig('aws', {
      region: 'us-east-1',
      tagKey: 'cluster',
      tagValue: 'helios',
    });
    const members = await provider.discover(config);
    expect(members.length).toBeGreaterThanOrEqual(1);
    expect(members.every(m => typeof m.host === 'string' && m.port > 0)).toBe(true);
  });

  test('returns empty array on fetch failure', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network error'))) as unknown as typeof fetch;
    const provider = new AwsDiscoveryProvider();
    const config = makeConfig('aws', { region: 'us-east-1' });
    const members = await provider.discover(config);
    expect(members).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AzureDiscoveryProvider
// ---------------------------------------------------------------------------

describe('AzureDiscoveryProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('discovers members from Azure VMSS response', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        value: [
          { properties: { privateIPAddress: '172.16.0.1' } },
          { properties: { privateIPAddress: '172.16.0.2' } },
        ],
      }),
    };
    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response)) as unknown as typeof fetch;

    const provider = new AzureDiscoveryProvider();
    const config = makeConfig('azure', { subscriptionId: 'sub-1', resourceGroup: 'rg-1' });
    const members = await provider.discover(config);
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty array on HTTP error', async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: false, status: 403 } as Response)) as unknown as typeof fetch;
    const provider = new AzureDiscoveryProvider();
    const config = makeConfig('azure', { subscriptionId: 'sub-1' });
    const members = await provider.discover(config);
    expect(members).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GcpDiscoveryProvider
// ---------------------------------------------------------------------------

describe('GcpDiscoveryProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('discovers members from GCP instances list', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        items: [
          { networkInterfaces: [{ networkIP: '10.128.0.1' }] },
          { networkInterfaces: [{ networkIP: '10.128.0.2' }] },
        ],
      }),
    };
    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response)) as unknown as typeof fetch;

    const provider = new GcpDiscoveryProvider();
    const config = makeConfig('gcp', { project: 'my-project', zone: 'us-central1-a' });
    const members = await provider.discover(config);
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty when items missing from response', async () => {
    globalThis.fetch = mock(() => Promise.resolve({
      ok: true,
      json: async () => ({}),
    } as Response)) as unknown as typeof fetch;
    const provider = new GcpDiscoveryProvider();
    const config = makeConfig('gcp', { project: 'p', zone: 'z' });
    const members = await provider.discover(config);
    expect(members).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// K8sDiscoveryProvider
// ---------------------------------------------------------------------------

describe('K8sDiscoveryProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('discovers members from Kubernetes endpoints', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        subsets: [
          {
            addresses: [
              { ip: '192.168.1.10' },
              { ip: '192.168.1.11' },
            ],
          },
        ],
      }),
    };
    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response)) as unknown as typeof fetch;

    const provider = new K8sDiscoveryProvider();
    const config = makeConfig('k8s', {
      namespace: 'default',
      serviceName: 'helios',
    });
    const members = await provider.discover(config);
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  test('uses KUBERNETES_SERVICE_HOST env when available', async () => {
    process.env['KUBERNETES_SERVICE_HOST'] = '10.96.0.1';
    const mockResponse = {
      ok: true,
      json: async () => ({ subsets: [] }),
    };
    globalThis.fetch = mock(() => Promise.resolve(mockResponse as Response)) as unknown as typeof fetch;

    const provider = new K8sDiscoveryProvider();
    const config = makeConfig('k8s', { namespace: 'default', serviceName: 'helios' });
    const members = await provider.discover(config);
    expect(Array.isArray(members)).toBe(true);
    delete process.env['KUBERNETES_SERVICE_HOST'];
  });
});

// ---------------------------------------------------------------------------
// HeliosDiscoveryResolver
// ---------------------------------------------------------------------------

describe('HeliosDiscoveryResolver', () => {
  test('resolves using the first matching provider', async () => {
    const staticProvider = new StaticDiscoveryProvider();
    const resolver = createDiscoveryResolver([staticProvider]);
    const joinConfig = makeJoinConfig([
      makeConfig('static', { addresses: '127.0.0.1:5701' }),
    ]);
    const members = await resolver.resolve(joinConfig, [staticProvider]);
    expect(members).toHaveLength(1);
    expect(members[0].host).toBe('127.0.0.1');
  });

  test('tries multiple providers and collects results', async () => {
    const p1 = new StaticDiscoveryProvider();
    const p2 = new StaticDiscoveryProvider();
    const resolver = createDiscoveryResolver([p1, p2]);
    const joinConfig = makeJoinConfig([
      makeConfig('static', { addresses: '10.0.0.1:5701' }),
      makeConfig('static', { addresses: '10.0.0.2:5701' }),
    ]);
    // Two configs both map to static — resolver iterates discoveryConfigs
    const members = await resolver.resolve(joinConfig, [p1]);
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty array when no providers match', async () => {
    const resolver = createDiscoveryResolver([]);
    const joinConfig = makeJoinConfig([makeConfig('aws', {})]);
    const members = await resolver.resolve(joinConfig, []);
    expect(members).toHaveLength(0);
  });

  test('respects AbortSignal on static provider', async () => {
    const provider = new StaticDiscoveryProvider();
    const resolver = createDiscoveryResolver([provider]);
    const joinConfig = makeJoinConfig([makeConfig('static', { addresses: '10.0.0.1:5701' })]);
    const controller = new AbortController();
    // Not aborting — just verifying signal parameter is accepted
    const members = await resolver.resolve(joinConfig, [provider], controller.signal);
    expect(members).toHaveLength(1);
  });
});
