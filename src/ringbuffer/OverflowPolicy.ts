/**
 * Controls behavior when an item is about to be added to the ringbuffer
 * but there is 0 remaining capacity.
 */
export class OverflowPolicy {
    static readonly OVERWRITE = new OverflowPolicy(0);
    static readonly FAIL = new OverflowPolicy(1);

    private constructor(private readonly id: number) {}

    getId(): number {
        return this.id;
    }

    static getById(id: number): OverflowPolicy | null {
        for (const policy of [OverflowPolicy.OVERWRITE, OverflowPolicy.FAIL]) {
            if (policy.id === id) {
                return policy;
            }
        }
        return null;
    }
}
