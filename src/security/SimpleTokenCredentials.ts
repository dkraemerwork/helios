import type { TokenCredentials } from './TokenCredentials';

/** Port of com.hazelcast.security.SimpleTokenCredentials */
export class SimpleTokenCredentials implements TokenCredentials {
    private _token: Buffer | null;

    constructor(token?: Buffer | null) {
        if (arguments.length > 0 && token !== undefined) {
            if (token === null) throw new Error('Token has to be provided.');
            this._token = Buffer.from(token);
        } else {
            this._token = null;
        }
    }

    getToken(): Buffer | null {
        return this._token !== null ? Buffer.from(this._token) : null;
    }

    getName(): string {
        return this._token === null ? '<empty>' : '<token>';
    }

    toString(): string {
        return `SimpleTokenCredentials [tokenLength=${this._token !== null ? this._token.length : 0}]`;
    }
}
