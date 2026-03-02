import { InstancePermission } from './InstancePermission';
import { ActionConstants } from './ActionConstants';

/** Port of com.hazelcast.security.permission.ListPermission */
export class ListPermission extends InstancePermission {
    private static readonly ADD = 4;
    private static readonly REMOVE = 8;
    private static readonly READ = 16;
    private static readonly LISTEN = 32;
    private static readonly ALL =
        ListPermission.CREATE | ListPermission.DESTROY | ListPermission.ADD |
        ListPermission.REMOVE | ListPermission.READ | ListPermission.LISTEN;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return ListPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_ADD)    mask |= ListPermission.ADD;
            else if (action === ActionConstants.ACTION_REMOVE) mask |= ListPermission.REMOVE;
            else if (action === ActionConstants.ACTION_READ)   mask |= ListPermission.READ;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_LISTEN) mask |= ListPermission.LISTEN;
        }
        return mask;
    }
}
