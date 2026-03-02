import { ClusterPermissionCollection } from './ClusterPermissionCollection';

/** Port of com.hazelcast.security.permission.ClusterPermission */
export abstract class ClusterPermission {
    private readonly _name: string;
    private _hashcode = 0;

    constructor(name: string) {
        this._name = name;
    }

    getName(): string { return this._name; }

    abstract implies(permission: ClusterPermission): boolean;
    abstract getActions(): string;

    newPermissionCollection(): ClusterPermissionCollection {
        return new ClusterPermissionCollection(this.constructor as new (...args: unknown[]) => ClusterPermission);
    }

    hashCode(): number {
        if (this._hashcode === 0) {
            const prime = 31;
            let result = 1;
            if (this._name == null) {
                result = prime * result + 13;
            } else {
                let hash = 0;
                for (let i = 0; i < this._name.length; i++) {
                    hash = (Math.imul(31, hash) + this._name.charCodeAt(i)) | 0;
                }
                result = prime * result + hash;
            }
            this._hashcode = result;
        }
        return this._hashcode;
    }

    equals(obj: unknown): boolean {
        if (this === obj) return true;
        if (obj == null) return false;
        if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(obj)) return false;
        const other = obj as ClusterPermission;
        if (this._name == null && other._name != null) return false;
        if (this._name !== other._name) return false;
        return true;
    }
}
