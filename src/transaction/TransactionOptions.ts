/**
 * Port of {@code com.hazelcast.transaction.TransactionOptions}.
 *
 * Configuration for a Helios transaction (type, durability, timeout).
 */

/**
 * Port of {@code com.hazelcast.transaction.TransactionOptions.TransactionType}.
 *
 * Class-based enum (Java-style) with id() and getById() support.
 */
export class TransactionType {
    static readonly ONE_PHASE: TransactionType = new TransactionType(1, 'ONE_PHASE');
    static readonly TWO_PHASE: TransactionType = new TransactionType(2, 'TWO_PHASE');

    private static readonly _values: readonly TransactionType[] = [
        TransactionType.ONE_PHASE,
        TransactionType.TWO_PHASE,
    ];

    private constructor(
        private readonly _id: number,
        private readonly _name: string,
    ) {}

    id(): number {
        return this._id;
    }

    static values(): readonly TransactionType[] {
        return TransactionType._values;
    }

    static getById(id: number): TransactionType {
        switch (id) {
            case 1: return TransactionType.ONE_PHASE;
            case 2: return TransactionType.TWO_PHASE;
            default: throw new Error(`Unrecognized TransactionType id: ${id}`);
        }
    }

    toString(): string {
        return this._name;
    }
}

/**
 * Configuration object for transactions.
 */
export class TransactionOptions {
    /** Default transaction timeout: 2 minutes. */
    static readonly DEFAULT_TIMEOUT_MILLIS = 2 * 60 * 1000;

    private _timeoutMillis: number = TransactionOptions.DEFAULT_TIMEOUT_MILLIS;
    private _durability: number = 1;
    private _transactionType: TransactionType = TransactionType.TWO_PHASE;

    constructor() {
        // defaults: TWO_PHASE, durability=1, timeout=2 minutes
    }

    getTransactionType(): TransactionType {
        return this._transactionType;
    }

    setTransactionType(type: TransactionType): this {
        if (type == null) throw new Error("transactionType can't be null");
        this._transactionType = type;
        return this;
    }

    getTimeoutMillis(): number {
        return this._timeoutMillis;
    }

    setTimeout(timeout: number, unit: 'MILLISECONDS' | 'SECONDS' | 'MINUTES' = 'MILLISECONDS'): this {
        if (timeout < 0) throw new Error('Timeout can not be negative!');
        if (timeout === 0) {
            this._timeoutMillis = TransactionOptions.DEFAULT_TIMEOUT_MILLIS;
        } else {
            switch (unit) {
                case 'MILLISECONDS': this._timeoutMillis = timeout; break;
                case 'SECONDS':      this._timeoutMillis = timeout * 1000; break;
                case 'MINUTES':      this._timeoutMillis = timeout * 60 * 1000; break;
            }
        }
        return this;
    }

    getDurability(): number {
        return this._durability;
    }

    setDurability(durability: number): this {
        if (durability < 0) throw new Error('Durability cannot be negative!');
        this._durability = durability;
        return this;
    }

    static getDefault(): TransactionOptions {
        return new TransactionOptions();
    }

    toString(): string {
        return `TransactionOptions{timeoutMillis=${this._timeoutMillis}, durability=${this._durability}, txType=${this._transactionType}}`;
    }
}
