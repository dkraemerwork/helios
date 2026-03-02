import { InstancePermission } from './InstancePermission';
import { ActionConstants } from './ActionConstants';

/** Port of com.hazelcast.security.permission.LockPermission */
export class LockPermission extends InstancePermission {
    private static readonly LOCK = 4;
    private static readonly READ = 8;
    private static readonly ALL =
        LockPermission.CREATE | LockPermission.DESTROY |
        LockPermission.LOCK | LockPermission.READ;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return LockPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_LOCK)    mask |= LockPermission.LOCK;
            else if (action === ActionConstants.ACTION_READ)    mask |= LockPermission.READ;
        }
        return mask;
    }
}
