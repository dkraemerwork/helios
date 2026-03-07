/**
 * Port of {@code com.hazelcast.client.config.ClientFailoverConfig}.
 *
 * Multi-cluster failover configuration: a list of alternative ClientConfigs
 * and a round-robin try count.
 */
import type { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";

export class ClientFailoverConfig {
  private _tryCount: number = Number.MAX_SAFE_INTEGER;
  private readonly _clientConfigs: ClientConfig[] = [];

  getTryCount(): number {
    return this._tryCount;
  }

  setTryCount(tryCount: number): this {
    if (tryCount < 0) throw new Error("tryCount must be >= 0");
    this._tryCount = tryCount;
    return this;
  }

  addClientConfig(config: ClientConfig): this {
    this._clientConfigs.push(config);
    return this;
  }

  getClientConfigs(): readonly ClientConfig[] {
    return this._clientConfigs;
  }
}
