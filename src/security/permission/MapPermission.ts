import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.MapPermission */
export class MapPermission extends InstancePermission {
    private static readonly PUT = 4;
    private static readonly REMOVE = 8;
    private static readonly READ = 16;
    private static readonly LISTEN = 32;
    private static readonly LOCK = 64;
    private static readonly INDEX = 128;
    private static readonly INTERCEPT = 256;
    private static readonly ALL =
        MapPermission.CREATE | MapPermission.DESTROY | MapPermission.PUT |
        MapPermission.REMOVE | MapPermission.READ | MapPermission.LISTEN |
        MapPermission.LOCK | MapPermission.INDEX | MapPermission.INTERCEPT;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return MapPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)    mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY)   mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_PUT)       mask |= MapPermission.PUT;
            else if (action === ActionConstants.ACTION_REMOVE)    mask |= MapPermission.REMOVE;
            else if (action === ActionConstants.ACTION_READ)      mask |= MapPermission.READ;
            else if (action === ActionConstants.ACTION_LISTEN)    mask |= MapPermission.LISTEN;
            else if (action === ActionConstants.ACTION_LOCK)      mask |= MapPermission.LOCK;
            else if (action === ActionConstants.ACTION_INDEX)     mask |= MapPermission.INDEX;
            else if (action === ActionConstants.ACTION_INTERCEPT) mask |= MapPermission.INTERCEPT;
        }
        return mask;
    }
}
