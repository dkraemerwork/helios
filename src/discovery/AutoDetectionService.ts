/**
 * AutoDetectionService — detects the current cloud environment by probing
 * real environment indicators (files, env vars, metadata endpoints).
 *
 * Detection order (first match wins):
 *   1. Kubernetes   — service-account token file present OR env vars set
 *   2. AWS          — EC2 IMDS reachable (169.254.169.254)
 *   3. GCP          — GCE metadata server reachable (169.254.169.254 / metadata.google.internal)
 *   4. Azure        — IMDS reachable (169.254.169.254 with Azure Metadata header)
 *   5. static       — fallback
 */

import type { DiscoveryStrategyFactory } from '@zenystx/helios-core/discovery/spi/DiscoverySPI';

// Metadata endpoint timeouts — must be short to avoid blocking startup.
const METADATA_TIMEOUT_MS = 1_000;

/** Well-known environment type strings used as strategy identifiers. */
export type CloudEnvironment = 'kubernetes' | 'aws' | 'gcp' | 'azure' | 'static';

export class AutoDetectionService {
  private readonly _factories: Map<string, DiscoveryStrategyFactory>;

  constructor(factories: Map<string, DiscoveryStrategyFactory>) {
    this._factories = factories;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Probe the environment and return the detected cloud type string.
   * Checks are performed in priority order; the first positive check wins.
   */
  async detect(): Promise<CloudEnvironment> {
    if (await this._isKubernetes()) return 'kubernetes';
    if (await this._isAws()) return 'aws';
    if (await this._isGcp()) return 'gcp';
    if (await this._isAzure()) return 'azure';
    return 'static';
  }

  /**
   * Return the factory registered for a given environment type.
   * Falls back to the 'static' factory if the specific one is not registered.
   *
   * @throws Error if neither the requested factory nor the 'static' factory exists.
   */
  selectFactory(environment: CloudEnvironment): DiscoveryStrategyFactory {
    const factory = this._factories.get(environment) ?? this._factories.get('static');
    if (!factory) {
      throw new Error(
        `No DiscoveryStrategyFactory registered for environment "${environment}" ` +
        `and no fallback "static" factory available. ` +
        `Registered: [${[...this._factories.keys()].join(', ')}]`,
      );
    }
    return factory;
  }

  // -------------------------------------------------------------------------
  // Environment probes
  // -------------------------------------------------------------------------

  /**
   * Kubernetes detection:
   *   - Service-account token file (/var/run/secrets/kubernetes.io/serviceaccount/token)
   *   - OR KUBERNETES_SERVICE_HOST env var
   */
  private async _isKubernetes(): Promise<boolean> {
    if (process.env['KUBERNETES_SERVICE_HOST']) return true;

    const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
    try {
      const file = Bun.file(tokenPath);
      return await file.exists();
    } catch {
      return false;
    }
  }

  /**
   * AWS detection: EC2 Instance Metadata Service v2 (IMDSv2).
   * PUT to /latest/api/token, then GET /latest/meta-data/ with the token.
   * Falls back to a plain GET which works on non-restricted IMDS.
   */
  private async _isAws(): Promise<boolean> {
    const imdsBase = 'http://169.254.169.254';
    const signal = AbortSignal.timeout(METADATA_TIMEOUT_MS);

    try {
      // IMDSv2: acquire session token
      const tokenRes = await fetch(`${imdsBase}/latest/api/token`, {
        method: 'PUT',
        headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '10' },
        signal,
      });
      if (tokenRes.ok) {
        const token = await tokenRes.text();
        const metaRes = await fetch(`${imdsBase}/latest/meta-data/`, {
          headers: { 'X-aws-ec2-metadata-token': token },
          signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        });
        return metaRes.ok;
      }
    } catch {
      // IMDSv2 not available — try IMDSv1 fallback
    }

    try {
      const res = await fetch(`${imdsBase}/latest/meta-data/`, {
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * GCP detection: GCE metadata server.
   * Must include the "Metadata-Flavor: Google" header for a valid response.
   */
  private async _isGcp(): Promise<boolean> {
    const signal = AbortSignal.timeout(METADATA_TIMEOUT_MS);
    try {
      const res = await fetch('http://metadata.google.internal/computeMetadata/v1/', {
        headers: { 'Metadata-Flavor': 'Google' },
        signal,
      });
      return res.ok && res.headers.get('metadata-flavor') === 'Google';
    } catch {
      return false;
    }
  }

  /**
   * Azure detection: Azure IMDS endpoint.
   * Requires the "Metadata: true" header; returns a JSON document on success.
   */
  private async _isAzure(): Promise<boolean> {
    const signal = AbortSignal.timeout(METADATA_TIMEOUT_MS);
    try {
      const res = await fetch(
        'http://169.254.169.254/metadata/instance?api-version=2021-02-01',
        {
          headers: { Metadata: 'true' },
          signal,
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
