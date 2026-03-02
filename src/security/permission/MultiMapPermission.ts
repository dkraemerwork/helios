import { MapPermission } from './MapPermission';

/** Port of com.hazelcast.security.permission.MultiMapPermission — same mask as MapPermission */
export class MultiMapPermission extends MapPermission {
    constructor(name: string, ...actions: string[]) { super(name, ...actions); }
}
