import type { Credentials } from './Credentials';

/** Port of com.hazelcast.security.PasswordCredentials */
export interface PasswordCredentials extends Credentials {
    getPassword(): string | null;
}
