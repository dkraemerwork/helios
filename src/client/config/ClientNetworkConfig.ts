/**
 * Port of {@code com.hazelcast.client.config.ClientNetworkConfig}.
 *
 * Network configuration for the Helios remote client: candidate cluster
 * addresses, connection timeout, and redo-operation policy.
 */
export class ClientNetworkConfig {
  private readonly _addresses: string[] = [];
  private _connectionTimeout: number = 5000;
  private _redoOperation: boolean = false;

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

  isRedoOperation(): boolean {
    return this._redoOperation;
  }

  setRedoOperation(redo: boolean): this {
    this._redoOperation = redo;
    return this;
  }
}
