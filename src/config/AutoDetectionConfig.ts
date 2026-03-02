export class AutoDetectionConfig {
    private _enabled: boolean = true;

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }
}
