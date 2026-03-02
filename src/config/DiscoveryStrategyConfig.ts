export class DiscoveryStrategyConfig {
    private _className: string | null = null;
    private _properties: Map<string, string> = new Map();

    getClassName(): string | null {
        return this._className;
    }

    setClassName(className: string): this {
        this._className = className;
        return this;
    }

    getProperties(): Map<string, string> {
        return this._properties;
    }
}
