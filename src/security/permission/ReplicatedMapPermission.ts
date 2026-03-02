import { InstancePermission } from './InstancePermission';
import { ActionConstants } from './ActionConstants';

/** Port of com.hazelcast.security.permission.ReplicatedMapPermission */
export class ReplicatedMapPermission extends InstancePermission {
    private static readonly PUT = 4;
    private static readonly REMOVE = 8;
    private static readonly READ = 16;
    private static readonly LISTEN = 32;
    private static readonly LOCK = 64;
    private static readonly INDEX = 128;
    private static readonly INTERCEPT = 256;
    private static readonly ALL =
        ReplicatedMapPermission.CREATE | ReplicatedMapPermission.DESTROY |
        ReplicatedMapPermission.PUT | ReplicatedMapPermission.REMOVE |
        ReplicatedMapPermission.READ | ReplicatedMapPermission.LISTEN |
        ReplicatedMapPermission.LOCK | ReplicatedMapPermission.INDEX |
        ReplicatedMapPermission.INTERCEPT;

    constructor(name: string, ...actions: string[]) { super(name, ...actions); }

    protected initMask(actions: string[]): number {
        let mask = InstancePermission.NONE;
        for (const action of actions) {
            if (action === ActionConstants.ACTION_ALL) return ReplicatedMapPermission.ALL;
            if (action === ActionConstants.ACTION_CREATE)    mask |= InstancePermission.CREATE;
            else if (action === ActionConstants.ACTION_DESTROY)   mask |= InstancePermission.DESTROY;
            else if (action === ActionConstants.ACTION_PUT)       mask |= ReplicatedMapPermission.PUT;
            else if (action === ActionConstants.ACTION_REMOVE)    mask |= ReplicatedMapPermission.REMOVE;
            else if (action === ActionConstants.ACTION_READ)      mask |= ReplicatedMapPermission.READ;
            else if (action === ActionConstants.ACTION_LISTEN)    mask |= ReplicatedMapPermission.LISTEN;
            else if (action === ActionConstants.ACTION_LOCK)      mask |= ReplicatedMapPermission.LOCK;
            else if (action === ActionConstants.ACTION_INDEX)     mask |= ReplicatedMapPermission.INDEX;
            else if (action === ActionConstants.ACTION_INTERCEPT) mask |= ReplicatedMapPermission.INTERCEPT;
        }
        return mask;
    }
}
