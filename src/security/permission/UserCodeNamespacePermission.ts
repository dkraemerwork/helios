import { InstancePermission } from './InstancePermission';
import { ActionConstants } from './ActionConstants';

/** Port of com.hazelcast.security.permission.UserCodeNamespacePermission */
export class UserCodeNamespacePermission extends InstancePermission {
    private static readonly USE = 4;
    private static readonly ALL =
        UserCodeNamespacePermission.CREATE | UserCodeNamespacePermission.DESTROY |
        UserCodeNamespacePermission.USE;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return UserCodeNamespacePermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_USE)    mask |= UserCodeNamespacePermission.USE;
        }
        return mask;
    }
}
