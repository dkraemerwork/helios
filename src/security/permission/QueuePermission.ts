import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.QueuePermission */
export class QueuePermission extends InstancePermission {
    private static readonly ADD = 4;
    private static readonly REMOVE = 8;
    private static readonly READ = 16;
    private static readonly LISTEN = 32;
    private static readonly ALL =
        QueuePermission.CREATE | QueuePermission.DESTROY | QueuePermission.ADD |
        QueuePermission.REMOVE | QueuePermission.READ | QueuePermission.LISTEN;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return QueuePermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_ADD)    mask |= QueuePermission.ADD;
            else if (action === ActionConstants.ACTION_READ)   mask |= QueuePermission.READ;
            else if (action === ActionConstants.ACTION_REMOVE) mask |= QueuePermission.REMOVE;
            else if (action === ActionConstants.ACTION_LISTEN) mask |= QueuePermission.LISTEN;
        }
        return mask;
    }
}
