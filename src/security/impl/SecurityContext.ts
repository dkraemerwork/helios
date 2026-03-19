/**
 * Per-session security context.
 *
 * Holds the authenticated principal identity and the set of permissions granted
 * to that principal.  Created after successful authentication and attached to
 * the client session for the lifetime of that connection.
 *
 * Port of com.hazelcast.security.SecurityContext (subset relevant to client sessions).
 */
import type { PermissionConfig } from '../../config/SecurityConfig.js';
import { PermissionType } from '../../config/SecurityConfig.js';
import { AccessControlException } from '../AccessControlException.js';
import type { ClusterPermission } from '../permission/ClusterPermission.js';
import { ClusterPermissionCollection } from '../permission/ClusterPermissionCollection.js';

// Permission class imports — resolved lazily in the factory to mirror ActionConstants pattern.
import { MapPermission } from '../permission/MapPermission.js';
import { QueuePermission } from '../permission/QueuePermission.js';
import { TopicPermission } from '../permission/TopicPermission.js';
import { ListPermission } from '../permission/ListPermission.js';
import { SetPermission } from '../permission/SetPermission.js';
import { MultiMapPermission } from '../permission/MultiMapPermission.js';
import { LockPermission } from '../permission/LockPermission.js';
import { SemaphorePermission } from '../permission/SemaphorePermission.js';
import { AtomicLongPermission } from '../permission/AtomicLongPermission.js';
import { AtomicReferencePermission } from '../permission/AtomicReferencePermission.js';
import { CountDownLatchPermission } from '../permission/CountDownLatchPermission.js';
import { ExecutorServicePermission } from '../permission/ExecutorServicePermission.js';
import { CachePermission } from '../permission/CachePermission.js';
import { ReplicatedMapPermission } from '../permission/ReplicatedMapPermission.js';
import { FlakeIdGeneratorPermission } from '../permission/FlakeIdGeneratorPermission.js';
import { CardinalityEstimatorPermission } from '../permission/CardinalityEstimatorPermission.js';
import { ScheduledExecutorPermission } from '../permission/ScheduledExecutorPermission.js';
import { CPMapPermission } from '../permission/CPMapPermission.js';

// ── Factory helper ────────────────────────────────────────────────────────────

function buildPermissionFromConfig(config: PermissionConfig): ClusterPermission | null {
    const name = config.getName() || '*';
    const actions = config.getActions();

    switch (config.getType()) {
        case PermissionType.MAP:
            return new MapPermission(name, ...actions);
        case PermissionType.QUEUE:
            return new QueuePermission(name, ...actions);
        case PermissionType.TOPIC:
            return new TopicPermission(name, ...actions);
        case PermissionType.LIST:
            return new ListPermission(name, ...actions);
        case PermissionType.SET:
            return new SetPermission(name, ...actions);
        case PermissionType.MULTIMAP:
            return new MultiMapPermission(name, ...actions);
        case PermissionType.LOCK:
            return new LockPermission(name, ...actions);
        case PermissionType.SEMAPHORE:
            return new SemaphorePermission(name, ...actions);
        case PermissionType.ATOMIC_LONG:
            return new AtomicLongPermission(name, ...actions);
        case PermissionType.ATOMIC_REFERENCE:
            return new AtomicReferencePermission(name, ...actions);
        case PermissionType.COUNTDOWN_LATCH:
            return new CountDownLatchPermission(name, ...actions);
        case PermissionType.EXECUTOR_SERVICE:
            return new ExecutorServicePermission(name, ...actions);
        case PermissionType.CACHE:
            return new CachePermission(name, ...actions);
        case PermissionType.REPLICATED_MAP:
            return new ReplicatedMapPermission(name, ...actions);
        case PermissionType.FLAKE_ID_GENERATOR:
            return new FlakeIdGeneratorPermission(name, ...actions);
        case PermissionType.CARDINALITY_ESTIMATOR:
            return new CardinalityEstimatorPermission(name, ...actions);
        case PermissionType.SCHEDULED_EXECUTOR:
            return new ScheduledExecutorPermission(name, ...actions);
        case PermissionType.CP_MAP:
            return new CPMapPermission(name, ...actions);
        case PermissionType.ALL:
            // ALL type: add a wildcard permission for every type
            return null; // handled specially below
        default:
            return null;
    }
}

function buildAllPermissions(name: string, actions: string[]): ClusterPermission[] {
    return [
        new MapPermission(name, ...actions),
        new QueuePermission(name, ...actions),
        new TopicPermission(name, ...actions),
        new ListPermission(name, ...actions),
        new SetPermission(name, ...actions),
        new MultiMapPermission(name, ...actions),
        new LockPermission(name, ...actions),
        new SemaphorePermission(name, ...actions),
        new AtomicLongPermission(name, ...actions),
        new AtomicReferencePermission(name, ...actions),
        new CountDownLatchPermission(name, ...actions),
        new ExecutorServicePermission(name, ...actions),
        new CachePermission(name, ...actions),
        new ReplicatedMapPermission(name, ...actions),
        new FlakeIdGeneratorPermission(name, ...actions),
        new CardinalityEstimatorPermission(name, ...actions),
        new ScheduledExecutorPermission(name, ...actions),
        new CPMapPermission(name, ...actions),
    ];
}

// ── SecurityContext ───────────────────────────────────────────────────────────

export class SecurityContext {
    /** Authenticated principal name (e.g. username or token subject). */
    readonly principal: string;
    /** All permissions granted to this principal. */
    readonly permissions: ClusterPermissionCollection;
    /** Whether this context represents an authenticated session. */
    readonly authenticated: boolean;
    /** Epoch ms when authentication succeeded. */
    readonly authenticationTime: number;
    /** Client endpoint (IP address or host:port) that owns this context. */
    readonly clientEndpoint: string;

    private constructor(
        principal: string,
        permissions: ClusterPermissionCollection,
        authenticated: boolean,
        authenticationTime: number,
        clientEndpoint: string,
    ) {
        this.principal = principal;
        this.permissions = permissions;
        this.authenticated = authenticated;
        this.authenticationTime = authenticationTime;
        this.clientEndpoint = clientEndpoint;
    }

    // ── Static factories ──────────────────────────────────────────────────────

    /**
     * Build a SecurityContext from a set of PermissionConfig objects.
     *
     * Each config is converted to the appropriate concrete ClusterPermission and
     * added to a ClusterPermissionCollection.  PermissionType.ALL expands into
     * a wildcard permission for every data-structure type.
     *
     * @param principal  The authenticated identity (username or token subject).
     * @param configs    The permission grants to apply.
     * @param endpoint   The client endpoint string (e.g. "192.168.1.5:54321").
     */
    static fromPermissionConfigs(
        principal: string,
        configs: PermissionConfig[],
        endpoint: string = '',
    ): SecurityContext {
        const collection = new ClusterPermissionCollection();
        for (const config of configs) {
            if (config.getType() === PermissionType.ALL) {
                const perms = buildAllPermissions(config.getName() || '*', config.getActions());
                for (const perm of perms) {
                    collection.add(perm);
                }
            } else {
                const perm = buildPermissionFromConfig(config);
                if (perm !== null) {
                    collection.add(perm);
                }
            }
        }
        return new SecurityContext(principal, collection, true, Date.now(), endpoint);
    }

    /**
     * Build an anonymous SecurityContext with no permissions.
     *
     * Used when security is disabled — all permission checks are bypassed at a
     * higher layer, but callers can still hold a SecurityContext reference safely.
     */
    static anonymous(): SecurityContext {
        return new SecurityContext('anonymous', new ClusterPermissionCollection(), false, 0, '');
    }

    // ── Permission checks ─────────────────────────────────────────────────────

    /**
     * Check whether this context grants the required permission.
     *
     * @throws AccessControlException if the permission is not granted.
     */
    checkPermission(requiredPermission: ClusterPermission): void {
        if (!this.hasPermission(requiredPermission)) {
            throw new AccessControlException(requiredPermission, this.principal);
        }
    }

    /**
     * Returns true if this context grants the required permission.
     */
    hasPermission(requiredPermission: ClusterPermission): boolean {
        return this.permissions.implies(requiredPermission);
    }
}
