import { ActionConstants } from './ActionConstants';
import { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.CPMapPermission */
export class CPMapPermission extends InstancePermission {
    private static readonly PUT = 4;
    private static readonly REMOVE = 8;
    private static readonly READ = 16;
    private static readonly ALL =
        CPMapPermission.CREATE | CPMapPermission.DESTROY |
        CPMapPermission.PUT | CPMapPermission.REMOVE | CPMapPermission.READ;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return CPMapPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)  mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY) mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_PUT)    mask |= CPMapPermission.PUT;
            else if (action === ActionConstants.ACTION_REMOVE) mask |= CPMapPermission.REMOVE;
            else if (action === ActionConstants.ACTION_READ)   mask |= CPMapPermission.READ;
        }
        return mask;
    }
}
