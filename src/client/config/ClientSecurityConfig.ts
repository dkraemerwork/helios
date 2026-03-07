/**
 * Port of {@code com.hazelcast.client.config.ClientSecurityConfig}.
 *
 * Holds identity credentials for client authentication.
 */
import type { Credentials } from "@zenystx/helios-core/security/Credentials";
import { UsernamePasswordCredentials } from "@zenystx/helios-core/security/UsernamePasswordCredentials";

export class ClientSecurityConfig {
  private _credentials: Credentials | null = null;

  setUsernamePasswordIdentity(username: string, password: string): this {
    this._credentials = new UsernamePasswordCredentials(username, password);
    return this;
  }

  setCredentials(credentials: Credentials): this {
    this._credentials = credentials;
    return this;
  }

  getCredentials(): Credentials | null {
    return this._credentials;
  }

  hasIdentityConfig(): boolean {
    return this._credentials !== null;
  }
}
