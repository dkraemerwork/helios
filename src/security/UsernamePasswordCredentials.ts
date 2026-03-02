import type { PasswordCredentials } from './PasswordCredentials';

/** Port of com.hazelcast.security.UsernamePasswordCredentials */
export class UsernamePasswordCredentials implements PasswordCredentials {
    private _name: string | null;
    private _password: string | null;

    constructor(username?: string | null, password?: string | null) {
        this._name = username ?? null;
        this._password = password ?? null;
    }

    getName(): string | null { return this._name; }
    setName(name: string): void { this._name = name; }

    getPassword(): string | null { return this._password; }
    setPassword(password: string): void { this._password = password; }

    toString(): string { return `UsernamePasswordCredentials{name=${this._name}}`; }
}
