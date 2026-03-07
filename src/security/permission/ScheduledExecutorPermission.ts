import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.ScheduledExecutorPermission */
export class ScheduledExecutorPermission extends InstancePermission {
    private static readonly READ = 4;
    private static readonly MODIFY = 8;
    private static readonly ALL =
        ScheduledExecutorPermission.READ | ScheduledExecutorPermission.MODIFY |
        ScheduledExecutorPermission.CREATE | ScheduledExecutorPermission.DESTROY;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return ScheduledExecutorPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_READ)   mask |= ScheduledExecutorPermission.READ;
            else if (action === ActionConstants.ACTION_MODIFY) mask |= ScheduledExecutorPermission.MODIFY;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
        }
        return mask;
    }
}
