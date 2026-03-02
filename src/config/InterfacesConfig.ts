export class InterfacesConfig {
    private _enabled: boolean = false;
    private _interfaces: string[] = [];

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    getInterfaces(): string[] {
        return this._interfaces;
    }

    addInterface(iface: string): this {
        this._interfaces.push(iface);
        return this;
    }

    clear(): this {
        this._interfaces = [];
        return this;
    }
}
