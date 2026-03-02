import { ListPermission } from './ListPermission';

/** Port of com.hazelcast.security.permission.SetPermission — same mask as ListPermission */
export class SetPermission extends ListPermission {
    constructor(name: string, ...actions: string[]) { super(name, ...actions); }
}
