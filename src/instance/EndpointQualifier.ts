/**
 * Port of {@code com.hazelcast.instance.EndpointQualifier}.
 */
export class EndpointQualifier {
    static readonly MEMBER = new EndpointQualifier(0, null);
    static readonly CLIENT = new EndpointQualifier(3, null);
    static readonly REST = new EndpointQualifier(4, null);
    static readonly MEMCACHE = new EndpointQualifier(5, null);
    static readonly WAN = new EndpointQualifier(2, null);

    constructor(
        readonly type: number,
        readonly identifier: string | null
    ) {}

    equals(other: unknown): boolean {
        if (!(other instanceof EndpointQualifier)) return false;
        return this.type === other.type && this.identifier === other.identifier;
    }

    toString(): string {
        return `EndpointQualifier{type=${this.type}, identifier=${this.identifier}}`;
    }
}
