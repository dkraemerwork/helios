import { InstancePermission } from './InstancePermission';
import { ActionConstants } from './ActionConstants';

/** Port of com.hazelcast.security.permission.SemaphorePermission */
export class SemaphorePermission extends InstancePermission {
    private static readonly ACQUIRE = 4;
    private static readonly RELEASE = 8;
    private static readonly READ = 16;
    private static readonly ALL =
        SemaphorePermission.CREATE | SemaphorePermission.DESTROY |
        SemaphorePermission.ACQUIRE | SemaphorePermission.RELEASE | SemaphorePermission.READ;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return SemaphorePermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)   mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_ACQUIRE) mask |= SemaphorePermission.ACQUIRE;
            else if (action === ActionConstants.ACTION_RELEASE) mask |= SemaphorePermission.RELEASE;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_READ)    mask |= SemaphorePermission.READ;
        }
        return mask;
    }
}
