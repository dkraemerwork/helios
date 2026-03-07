import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.CardinalityEstimatorPermission */
export class CardinalityEstimatorPermission extends InstancePermission {
    private static readonly READ = 4;
    private static readonly MODIFY = 8;
    private static readonly ALL =
        CardinalityEstimatorPermission.READ | CardinalityEstimatorPermission.MODIFY |
        CardinalityEstimatorPermission.CREATE | CardinalityEstimatorPermission.DESTROY;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return CardinalityEstimatorPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_READ)   mask |= CardinalityEstimatorPermission.READ;
            else if (action === ActionConstants.ACTION_MODIFY) mask |= CardinalityEstimatorPermission.MODIFY;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
        }
        return mask;
    }
}
