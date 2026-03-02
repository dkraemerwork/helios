export class MulticastConfig {
    static readonly DEFAULT_ENABLED = false;
    static readonly DEFAULT_MULTICAST_GROUP = '224.2.2.3';
    static readonly DEFAULT_MULTICAST_PORT = 54327;
    static readonly DEFAULT_MULTICAST_TIMEOUT_SECONDS = 2;
    static readonly DEFAULT_MULTICAST_TTL = 32;

    private _enabled: boolean = MulticastConfig.DEFAULT_ENABLED;
    private _multicastGroup: string = MulticastConfig.DEFAULT_MULTICAST_GROUP;
    private _multicastPort: number = MulticastConfig.DEFAULT_MULTICAST_PORT;
    private _multicastTimeoutSeconds: number = MulticastConfig.DEFAULT_MULTICAST_TIMEOUT_SECONDS;
    private _multicastTimeToLive: number = MulticastConfig.DEFAULT_MULTICAST_TTL;
    private _trustedInterfaces: Set<string> = new Set();
    private _loopbackModeEnabled: boolean | null = null;

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    getMulticastGroup(): string {
        return this._multicastGroup;
    }

    setMulticastGroup(multicastGroup: string): this {
        this._multicastGroup = multicastGroup;
        return this;
    }

    getMulticastPort(): number {
        return this._multicastPort;
    }

    setMulticastPort(multicastPort: number): this {
        this._multicastPort = multicastPort;
        return this;
    }

    getMulticastTimeoutSeconds(): number {
        return this._multicastTimeoutSeconds;
    }

    setMulticastTimeoutSeconds(multicastTimeoutSeconds: number): this {
        this._multicastTimeoutSeconds = multicastTimeoutSeconds;
        return this;
    }

    getMulticastTimeToLive(): number {
        return this._multicastTimeToLive;
    }

    setMulticastTimeToLive(multicastTimeToLive: number): this {
        this._multicastTimeToLive = multicastTimeToLive;
        return this;
    }

    getTrustedInterfaces(): Set<string> {
        return this._trustedInterfaces;
    }

    setTrustedInterfaces(trustedInterfaces: Set<string>): this {
        this._trustedInterfaces = trustedInterfaces;
        return this;
    }

    addTrustedInterface(iface: string): this {
        this._trustedInterfaces.add(iface);
        return this;
    }

    getLoopbackModeEnabled(): boolean | null {
        return this._loopbackModeEnabled;
    }

    setLoopbackModeEnabled(loopbackModeEnabled: boolean | null): this {
        this._loopbackModeEnabled = loopbackModeEnabled;
        return this;
    }
}
