import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.FlakeIdGeneratorPermission */
export class FlakeIdGeneratorPermission extends InstancePermission {
    private static readonly MODIFY = 4;
    private static readonly ALL =
        FlakeIdGeneratorPermission.CREATE | FlakeIdGeneratorPermission.DESTROY |
        FlakeIdGeneratorPermission.MODIFY;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return FlakeIdGeneratorPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_MODIFY) mask |= FlakeIdGeneratorPermission.MODIFY;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
        }
        return mask;
    }
}
