import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.VectorCollectionPermission */
export class VectorCollectionPermission extends InstancePermission {
    private static readonly PUT = 4;
    private static readonly REMOVE = 8;
    private static readonly READ = 16;
    private static readonly OPTIMIZE = 32;
    private static readonly ALL =
        VectorCollectionPermission.CREATE | VectorCollectionPermission.DESTROY |
        VectorCollectionPermission.PUT | VectorCollectionPermission.REMOVE |
        VectorCollectionPermission.READ | VectorCollectionPermission.OPTIMIZE;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return VectorCollectionPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)    mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY)  mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_PUT)      mask |= VectorCollectionPermission.PUT;
            else if (action === ActionConstants.ACTION_REMOVE)   mask |= VectorCollectionPermission.REMOVE;
            else if (action === ActionConstants.ACTION_READ)     mask |= VectorCollectionPermission.READ;
            else if (action === ActionConstants.ACTION_OPTIMIZE) mask |= VectorCollectionPermission.OPTIMIZE;
        }
        return mask;
    }
}
