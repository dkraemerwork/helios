import type { ClusterPermission } from './ClusterPermission';

/** Port of com.hazelcast.security.permission.ClusterPermissionCollection */
export class ClusterPermissionCollection {
    readonly perms = new Set<ClusterPermission>();
    private readonly permClass: (new (...args: unknown[]) => ClusterPermission) | null;
    private _readOnly = false;

    constructor(permClass?: new (...args: unknown[]) => ClusterPermission) {
        this.permClass = permClass ?? null;
    }

    isReadOnly(): boolean { return this._readOnly; }
    setReadOnly(): void { this._readOnly = true; }

    add(permission: ClusterPermission): void;
    add(permissions: ClusterPermissionCollection): void;
    add(permissionOrCollection: ClusterPermission | ClusterPermissionCollection): void {
        if (this._readOnly) throw new Error('ClusterPermissionCollection is read-only!');

        if (permissionOrCollection instanceof ClusterPermissionCollection) {
            for (const p of permissionOrCollection.perms) {
                this.add(p);
            }
            return;
        }

        const permission = permissionOrCollection;
        const shouldAdd = this.permClass == null || permission instanceof this.permClass;
        if (shouldAdd && !this.implies(permission)) {
            this.perms.add(permission);
        }
    }

    implies(permission: ClusterPermission): boolean {
        for (const p of this.perms) {
            if (p.implies(permission)) return true;
        }
        return false;
    }

    compact(): void {
        if (this._readOnly) throw new Error('ClusterPermissionCollection is read-only!');
        const toRemove: ClusterPermission[] = [];
        for (const perm of this.perms) {
            for (const p of this.perms) {
                if (p !== perm && p.implies(perm)) {
                    toRemove.push(perm);
                    break;
                }
            }
        }
        for (const p of toRemove) {
            this.perms.delete(p);
        }
    }

    elements(): IterableIterator<ClusterPermission> {
        return this.perms.values();
    }
}
