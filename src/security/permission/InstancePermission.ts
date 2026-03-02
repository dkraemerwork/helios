import { ClusterPermission } from './ClusterPermission';
import { wildcardMatches } from './WildcardPermissionMatcher';

/** Port of com.hazelcast.security.permission.InstancePermission */
export abstract class InstancePermission extends ClusterPermission {
    protected static readonly NONE = 0;
    protected static readonly CREATE = 1;
    protected static readonly DESTROY = 2;

    protected readonly mask: number;
    protected readonly _actions: string;

    constructor(name: string, ...actions: string[]) {
        super(name);
        if (name == null || name === '') {
            throw new Error('Permission name is mandatory!');
        }
        this.mask = this.initMask(actions);
        this._actions = actions.join(' ');
    }

    protected abstract initMask(actions: string[]): number;

    override implies(permission: ClusterPermission): boolean {
        if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(permission)) return false;
        const that = permission as InstancePermission;
        if ((this.mask & that.mask) !== that.mask) return false;
        return wildcardMatches(this.getName(), that.getName());
    }

    override getActions(): string { return this._actions; }

    override hashCode(): number {
        let result = super.hashCode();
        result = 31 * result + this.mask;
        let h = 0;
        for (let i = 0; i < this._actions.length; i++) {
            h = (Math.imul(31, h) + this._actions.charCodeAt(i)) | 0;
        }
        result = 31 * result + h;
        return result;
    }

    override equals(obj: unknown): boolean {
        if (this === obj) return true;
        if (obj == null) return false;
        if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(obj)) return false;
        const other = obj as InstancePermission;
        if (this.getName() == null && other.getName() != null) return false;
        if (this.getName() !== other.getName()) return false;
        if (this.mask !== other.mask) return false;
        return true;
    }
}
