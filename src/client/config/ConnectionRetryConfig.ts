/**
 * Port of {@code com.hazelcast.client.config.ConnectionRetryConfig}.
 *
 * Exponential-backoff retry configuration for the Helios remote client.
 */
export class ConnectionRetryConfig {
  private _initialBackoffMillis: number = 1000;
  private _maxBackoffMillis: number = 30000;
  private _multiplier: number = 1.05;
  private _clusterConnectTimeoutMillis: number = -1;
  private _jitter: number = 0;

  getInitialBackoffMillis(): number {
    return this._initialBackoffMillis;
  }

  setInitialBackoffMillis(millis: number): this {
    if (millis < 0) throw new Error("initialBackoffMillis must be >= 0");
    this._initialBackoffMillis = millis;
    return this;
  }

  getMaxBackoffMillis(): number {
    return this._maxBackoffMillis;
  }

  setMaxBackoffMillis(millis: number): this {
    if (millis < 0) throw new Error("maxBackoffMillis must be >= 0");
    this._maxBackoffMillis = millis;
    return this;
  }

  getMultiplier(): number {
    return this._multiplier;
  }

  setMultiplier(multiplier: number): this {
    if (multiplier < 1.0) throw new Error("multiplier must be >= 1.0");
    this._multiplier = multiplier;
    return this;
  }

  getClusterConnectTimeoutMillis(): number {
    return this._clusterConnectTimeoutMillis;
  }

  setClusterConnectTimeoutMillis(millis: number): this {
    this._clusterConnectTimeoutMillis = millis;
    return this;
  }

  getJitter(): number {
    return this._jitter;
  }

  setJitter(jitter: number): this {
    if (jitter < 0 || jitter > 1) throw new Error("jitter must be in [0, 1]");
    this._jitter = jitter;
    return this;
  }
}
