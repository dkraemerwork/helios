/**
 * Thrown when a client operation is denied by the permission enforcement layer.
 *
 * Port of com.hazelcast.security.AccessControlException (itself a subclass of
 * java.security.AccessControlException).
 */
import { HeliosException } from '../core/exception/HeliosException.js';
import type { ClusterPermission } from './permission/ClusterPermission.js';

export class AccessControlException extends HeliosException {
    /** The permission that was required but not granted. */
    readonly permission: ClusterPermission;
    /** The principal that was denied. */
    readonly principal: string;

    constructor(permission: ClusterPermission, principal: string, message?: string) {
        const msg = message ?? `Access denied for principal '${principal}' — required permission: ${permission.constructor.name}[name=${permission.getName()}, actions=${permission.getActions()}]`;
        super(msg);
        this.name = 'AccessControlException';
        this.permission = permission;
        this.principal = principal;
    }
}
