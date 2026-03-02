import { InstancePermission } from './InstancePermission';
import { ActionConstants } from './ActionConstants';

/** Port of com.hazelcast.security.permission.CachePermission */
export class CachePermission extends InstancePermission {
    private static readonly PUT = 4;
    private static readonly REMOVE = 8;
    private static readonly READ = 16;
    private static readonly LISTEN = 32;
    private static readonly ALL =
        CachePermission.CREATE | CachePermission.DESTROY | CachePermission.PUT |
        CachePermission.REMOVE | CachePermission.READ | CachePermission.LISTEN;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return CachePermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_PUT)    mask |= CachePermission.PUT;
            else if (action === ActionConstants.ACTION_REMOVE) mask |= CachePermission.REMOVE;
            else if (action === ActionConstants.ACTION_READ)   mask |= CachePermission.READ;
            else if (action === ActionConstants.ACTION_LISTEN) mask |= CachePermission.LISTEN;
        }
        return mask;
    }
}
