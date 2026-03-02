/**
 * Identity-based hash code for arbitrary objects, analogous to Java's
 * System.identityHashCode(). Assigns a unique sequential integer to each
 * object upon first call, stored in a WeakMap for GC-safety.
 */
const _ids = new WeakMap<object, number>();
let _nextId = 1;

export function objectIdentityHash(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === 'number') return value | 0;
    if (typeof value === 'string') {
        // FNV-1a over characters
        let h = 2166136261;
        for (let i = 0; i < value.length; i++) {
            h = Math.imul(h ^ value.charCodeAt(i), 16777619);
        }
        return h | 0;
    }
    if (typeof value === 'boolean') return value ? 1231 : 1237;
    if (typeof value === 'object' || typeof value === 'function') {
        let id = _ids.get(value as object);
        if (id === undefined) {
            id = _nextId++;
            _ids.set(value as object, id);
        }
        return id;
    }
    return 0;
}
