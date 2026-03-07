import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.TopicPermission */
export class TopicPermission extends InstancePermission {
    private static readonly PUBLISH = 4;
    private static readonly LISTEN = 8;
    private static readonly ALL =
        TopicPermission.CREATE | TopicPermission.DESTROY |
        TopicPermission.LISTEN | TopicPermission.PUBLISH;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return TopicPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)   mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_PUBLISH) mask |= TopicPermission.PUBLISH;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_LISTEN)  mask |= TopicPermission.LISTEN;
        }
        return mask;
    }
}
