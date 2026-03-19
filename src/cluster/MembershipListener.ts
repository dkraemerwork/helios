/**
 * Port of {@code com.hazelcast.cluster.MembershipListener} and
 * {@code com.hazelcast.cluster.MemberAttributeEvent}.
 *
 * Receives notifications for cluster membership and member attribute changes.
 * Register via {@link Cluster.addMembershipListener}.
 */

import type { Member } from '@zenystx/helios-core/cluster/Member.js';

// ── Event types ───────────────────────────────────────────────────────────────

/**
 * Describes a member joining or leaving the cluster.
 *
 * Port of {@code com.hazelcast.cluster.MembershipEvent}.
 */
export interface MembershipEvent {
    /** The member that joined or left. */
    readonly member: Member;
    /**
     * The complete set of members in the cluster at the time of the event,
     * including the event member for MEMBER_ADDED and excluding it for MEMBER_REMOVED.
     */
    readonly members: ReadonlySet<Member>;
    /** The type of the event. */
    readonly eventType: 'MEMBER_ADDED' | 'MEMBER_REMOVED';
}

/** Supported member attribute operation types (Hazelcast parity). */
export type MemberAttributeOperationType = 'PUT' | 'REMOVE';

/**
 * Fired when a member attribute is added, updated, or removed.
 *
 * Port of {@code com.hazelcast.cluster.MemberAttributeEvent}.
 */
export interface MemberAttributeEvent {
    /** The member whose attribute changed. */
    readonly member: Member;
    /**
     * The complete set of members in the cluster at the time of the event.
     */
    readonly members: ReadonlySet<Member>;
    /** The attribute key that was changed. */
    readonly key: string;
    /**
     * The new attribute value, or `null` when the attribute was removed
     * ({@link operationType} is `'REMOVE'`).
     */
    readonly value: string | null;
    /** Whether the attribute was added/updated (`PUT`) or removed (`REMOVE`). */
    readonly operationType: MemberAttributeOperationType;
}

// ── Listener ──────────────────────────────────────────────────────────────────

/**
 * Receives cluster membership and member attribute change events.
 *
 * Implement all three methods.  Use no-op stubs for callbacks you don't need:
 *
 * ```typescript
 * const listener: MembershipListener = {
 *   memberAdded:            (e) => console.log('joined', e.member),
 *   memberRemoved:          (e) => console.log('left',   e.member),
 *   memberAttributeChanged: (_e) => { /* no-op *\/ },
 * };
 * ```
 *
 * Port of {@code com.hazelcast.cluster.MembershipListener}.
 */
export interface MembershipListener {
    /**
     * Fired when a new member joins the cluster.
     *
     * @param event The membership event describing the joining member.
     */
    memberAdded(event: MembershipEvent): void;

    /**
     * Fired when a member leaves the cluster (gracefully or by failure detection).
     *
     * @param event The membership event describing the departing member.
     */
    memberRemoved(event: MembershipEvent): void;

    /**
     * Fired when a member's attribute is added, updated, or removed.
     *
     * Attribute changes are propagated cluster-wide via the member list update
     * mechanism.  Consumers should treat the event as advisory; the authoritative
     * attribute set is always available via {@link Member.getAttribute}.
     *
     * @param event The attribute change event.
     */
    memberAttributeChanged(event: MemberAttributeEvent): void;
}
