import { InstancePermission } from './InstancePermission';
import { ActionConstants } from './ActionConstants';

/** Port of com.hazelcast.security.permission.AtomicReferencePermission */
export class AtomicReferencePermission extends InstancePermission {
    private static readonly READ = 4;
    private static readonly MODIFY = 8;
    private static readonly ALL =
        AtomicReferencePermission.CREATE | AtomicReferencePermission.DESTROY |
        AtomicReferencePermission.READ | AtomicReferencePermission.MODIFY;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return AtomicReferencePermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_READ)   mask |= AtomicReferencePermission.READ;
            else if (action === ActionConstants.ACTION_MODIFY) mask |= AtomicReferencePermission.MODIFY;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
        }
        return mask;
    }
}
