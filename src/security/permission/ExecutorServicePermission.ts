import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.ExecutorServicePermission */
export class ExecutorServicePermission extends InstancePermission {
    private static readonly READ = 4;
    private static readonly MODIFY = 8;
    private static readonly ALL =
        ExecutorServicePermission.CREATE | ExecutorServicePermission.DESTROY |
        ExecutorServicePermission.READ | ExecutorServicePermission.MODIFY;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return ExecutorServicePermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_READ)   mask |= ExecutorServicePermission.READ;
            else if (action === ActionConstants.ACTION_MODIFY) mask |= ExecutorServicePermission.MODIFY;
        }
        return mask;
    }
}
