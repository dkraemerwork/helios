/**
 * Port of {@code com.hazelcast.client.config.ClientConnectionStrategyConfig}.
 *
 * Controls async-start, reconnect mode, and retry behavior.
 */
import { ConnectionRetryConfig } from "@zenystx/helios-core/client/config/ConnectionRetryConfig.js";
import {
  DEFAULT_ASYNC_START,
  DEFAULT_RECONNECT_MODE,
} from "@zenystx/helios-core/config/HazelcastDefaults.js";

export type ReconnectMode = "OFF" | "ON" | "ASYNC";

export class ClientConnectionStrategyConfig {
  private _asyncStart: boolean = DEFAULT_ASYNC_START;
  private _reconnectMode: ReconnectMode = DEFAULT_RECONNECT_MODE;
  private readonly _connectionRetryConfig: ConnectionRetryConfig = new ConnectionRetryConfig();

  isAsyncStart(): boolean {
    return this._asyncStart;
  }

  setAsyncStart(asyncStart: boolean): this {
    this._asyncStart = asyncStart;
    return this;
  }

  getReconnectMode(): ReconnectMode {
    return this._reconnectMode;
  }

  setReconnectMode(mode: ReconnectMode): this {
    this._reconnectMode = mode;
    return this;
  }

  getConnectionRetryConfig(): ConnectionRetryConfig {
    return this._connectionRetryConfig;
  }
}
