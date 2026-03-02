import type { Credentials } from './Credentials';

/** Port of com.hazelcast.security.TokenCredentials */
export interface TokenCredentials extends Credentials {
    getToken(): Buffer | null;
}
