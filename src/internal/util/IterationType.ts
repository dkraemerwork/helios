/**
 * Port of {@code com.hazelcast.internal.util.IterationType}.
 *
 * Differentiates user selection on result collection for map-wide operations
 * like values(), keySet(), query(), etc.
 */
export class IterationType {
    static readonly KEY   = new IterationType(0, 'KEY');
    static readonly VALUE = new IterationType(1, 'VALUE');
    static readonly ENTRY = new IterationType(2, 'ENTRY');

    private static readonly _VALUES: IterationType[] = [
        IterationType.KEY,
        IterationType.VALUE,
        IterationType.ENTRY,
    ];

    private constructor(
        private readonly _id: number,
        private readonly _name: string,
    ) {}

    getId(): number { return this._id; }

    toString(): string { return this._name; }

    static getById(id: number): IterationType {
        for (const type of IterationType._VALUES) {
            if (type._id === id) return type;
        }
        throw new Error(`unknown IterationType id: ${id}`);
    }
}
