export class RecentStringSet {
    private readonly _items = new Set<string>();
    private readonly _order: string[] = [];

    constructor(private readonly _limit = 4_096) {}

    has(value: string): boolean {
        return this._items.has(value);
    }

    add(value: string): void {
        if (this._items.has(value)) {
            return;
        }
        this._items.add(value);
        this._order.push(value);
        while (this._order.length > this._limit) {
            const oldest = this._order.shift();
            if (oldest !== undefined) {
                this._items.delete(oldest);
            }
        }
    }

    replace(values: readonly string[]): void {
        this._items.clear();
        this._order.length = 0;
        const start = Math.max(0, values.length - this._limit);
        for (let index = start; index < values.length; index++) {
            this.add(values[index]!);
        }
    }

    snapshot(): string[] {
        return [...this._order];
    }
}
