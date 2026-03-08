/**
 * Port of {@code com.hazelcast.client.config.ClientNetworkConfig}.
 *
 * Network configuration for the Helios remote client: candidate cluster
 * addresses, connection timeout, smart routing, and redo-operation policy.
 */
import {
  DEFAULT_CLIENT_CONNECTION_TIMEOUT_MS,
  DEFAULT_PORT,
  DEFAULT_SMART_ROUTING,
} from "@zenystx/helios-core/config/HazelcastDefaults.js";

export class ClientNetworkConfig {
  private readonly _addresses: string[] = [];
  private _connectionTimeout: number = DEFAULT_CLIENT_CONNECTION_TIMEOUT_MS;
  private _smartRouting: boolean = DEFAULT_SMART_ROUTING;
  private _redoOperation: boolean = false;
  private _defaultPort: number = DEFAULT_PORT;

  getAddresses(): readonly string[] {
    return this._addresses;
  }

  addAddress(...addresses: string[]): this {
    for (const addr of addresses) {
      if (!this._addresses.includes(addr)) {
        this._addresses.push(addr);
      }
    }
    return this;
  }

  setAddresses(addresses: string[]): this {
    this._addresses.length = 0;
    this._addresses.push(...addresses);
    return this;
  }

  getConnectionTimeout(): number {
    return this._connectionTimeout;
  }

  setConnectionTimeout(millis: number): this {
    if (millis < 0) {
      throw new Error("connectionTimeout must be >= 0");
    }
    this._connectionTimeout = millis;
    return this;
  }

  isSmartRouting(): boolean {
    return this._smartRouting;
  }

  setSmartRouting(smartRouting: boolean): this {
    this._smartRouting = smartRouting;
    return this;
  }

  isRedoOperation(): boolean {
    return this._redoOperation;
  }

  setRedoOperation(redo: boolean): this {
    this._redoOperation = redo;
    return this;
  }

  /**
   * Returns the default port used when a cluster member address has no explicit
   * port part.  Hazelcast default: 5701.
   */
  getDefaultPort(): number {
    return this._defaultPort;
  }

  setDefaultPort(port: number): this {
    if (port < 1 || port > 65_535) {
      throw new Error(`defaultPort must be in [1, 65535], got: ${port}`);
    }
    this._defaultPort = port;
    return this;
  }
}
