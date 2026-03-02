import { InstancePermission } from './InstancePermission';
import { ActionConstants } from './ActionConstants';

/** Port of com.hazelcast.security.permission.CountDownLatchPermission */
export class CountDownLatchPermission extends InstancePermission {
    private static readonly READ = 4;
    private static readonly MODIFY = 8;
    private static readonly ALL =
        CountDownLatchPermission.CREATE | CountDownLatchPermission.DESTROY |
        CountDownLatchPermission.READ | CountDownLatchPermission.MODIFY;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return CountDownLatchPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_READ)   mask |= CountDownLatchPermission.READ;
            else if (action === ActionConstants.ACTION_MODIFY) mask |= CountDownLatchPermission.MODIFY;
        }
        return mask;
    }
}
