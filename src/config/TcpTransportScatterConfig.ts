export class TcpTransportScatterConfig {
    static readonly DEFAULT_INPUT_CAPACITY_BYTES = 256 * 1024;
    static readonly DEFAULT_OUTPUT_CAPACITY_BYTES = 256 * 1024;

    private _enabled = true;
    private _inputCapacityBytes = TcpTransportScatterConfig.DEFAULT_INPUT_CAPACITY_BYTES;
    private _outputCapacityBytes = TcpTransportScatterConfig.DEFAULT_OUTPUT_CAPACITY_BYTES;

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    getInputCapacityBytes(): number {
        return this._inputCapacityBytes;
    }

    setInputCapacityBytes(capacityBytes: number): this {
        this._inputCapacityBytes = validateCapacity('inputCapacityBytes', capacityBytes);
        return this;
    }

    getOutputCapacityBytes(): number {
        return this._outputCapacityBytes;
    }

    setOutputCapacityBytes(capacityBytes: number): this {
        this._outputCapacityBytes = validateCapacity('outputCapacityBytes', capacityBytes);
        return this;
    }
}

function validateCapacity(name: string, value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer, was: ${value}`);
    }
    return value;
}
