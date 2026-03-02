/**
 * Port of {@code com.hazelcast.cluster.Address}.
 *
 * Represents a network address (host + port).
 */
export class Address {
    constructor(
        public readonly host: string,
        public readonly port: number,
    ) {}

    getHost(): string {
        return this.host;
    }

    getPort(): number {
        return this.port;
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof Address)) return false;
        return this.host === other.host && this.port === other.port;
    }

    hashCode(): number {
        let h = 0;
        for (const ch of this.host) {
            h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
        }
        return (Math.imul(31, h) + this.port) | 0;
    }

    toString(): string {
        return `[${this.host}]:${this.port}`;
    }
}
