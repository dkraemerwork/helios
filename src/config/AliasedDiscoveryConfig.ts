export abstract class AliasedDiscoveryConfig {
    private _enabled: boolean = false;
    private _usePublicIp: boolean = false;
    private _properties: Map<string, string> = new Map();

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    isUsePublicIp(): boolean {
        return this._usePublicIp;
    }

    setUsePublicIp(usePublicIp: boolean): this {
        this._usePublicIp = usePublicIp;
        return this;
    }

    setProperty(name: string, value: string): this {
        this._properties.set(name, value);
        return this;
    }

    getProperty(name: string): string | undefined {
        return this._properties.get(name);
    }

    getProperties(): Map<string, string> {
        return this._properties;
    }
}
