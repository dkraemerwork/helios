/**
 * Port of {@code com.hazelcast.client.impl.protocol.AuthenticationStatus}.
 */
export class AuthenticationStatus {
    private static readonly BY_ID = new Map<number, AuthenticationStatus>();

    static readonly AUTHENTICATED = new AuthenticationStatus(0);
    static readonly CREDENTIALS_FAILED = new AuthenticationStatus(1);
    static readonly SERIALIZATION_VERSION_MISMATCH = new AuthenticationStatus(2);
    static readonly NOT_ALLOWED_IN_CLUSTER = new AuthenticationStatus(3);

    private readonly _id: number;

    private constructor(id: number) {
        this._id = id;
        AuthenticationStatus.BY_ID.set(id, this);
    }

    getId(): number {
        return this._id;
    }

    static getById(id: number): AuthenticationStatus {
        const status = AuthenticationStatus.BY_ID.get(id);
        if (status === undefined) {
            throw new Error(`Unknown AuthenticationStatus id: ${id}`);
        }
        return status;
    }
}
