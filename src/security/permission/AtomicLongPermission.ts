import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.AtomicLongPermission */
export class AtomicLongPermission extends InstancePermission {
    private static readonly READ = 4;
    private static readonly MODIFY = 8;
    private static readonly ALL =
        AtomicLongPermission.CREATE | AtomicLongPermission.DESTROY |
        AtomicLongPermission.READ | AtomicLongPermission.MODIFY;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return AtomicLongPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_READ)   mask |= AtomicLongPermission.READ;
            else if (action === ActionConstants.ACTION_MODIFY) mask |= AtomicLongPermission.MODIFY;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
        }
        return mask;
    }
}
