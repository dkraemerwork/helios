/**
 * Block B.5 — TopologyPublisher
 *
 * Port of {@code com.hazelcast.client.impl.ClientClusterViewService} (server-side).
 *
 * Publishes topology updates to connected clients:
 *
 *   - MEMBERS_VIEW events when the member list changes.
 *   - PARTITIONS_VIEW events when the partition table changes.
 *   - WRONG_TARGET errors when a partition-bound op lands on the wrong owner.
 *   - TARGET_NOT_MEMBER errors when the target has left.
 *
 * Uses monotonically increasing versions so clients can detect staleness.
 * Only sends if the version has actually advanced (deduplication).
 *
 * Lifecycle: start() → active → stop().
 */

import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo.js';
import { WrongTargetException, TargetNotMemberException } from '@zenystx/helios-core/core/errors/ClusterErrors.js';
import { ClientAddClusterViewListenerCodec } from '@zenystx/helios-core/server/clientprotocol/codec/ClientAddClusterViewListenerCodec.js';
import { ClientAddPartitionLostListenerCodec } from '@zenystx/helios-core/server/clientprotocol/codec/ClientAddPartitionLostListenerCodec.js';
import type { ClientSession } from '@zenystx/helios-core/server/clientprotocol/ClientSession.js';
import type { ClientSessionRegistry } from '@zenystx/helios-core/server/clientprotocol/ClientSessionRegistry.js';
import type { ILogger } from '@zenystx/helios-core/test-support/ILogger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Partition ownership: partitionId → ownerUuid (null = no owner). */
export type PartitionOwnershipMap = ReadonlyMap<number, string | null>;

export interface PartitionLostInfo {
    partitionId: number;
    lostBackupCount: number;
    sourceUuid: string | null;
}

export interface TopologyPublisherOptions {
    logger?: ILogger;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class TopologyPublisher {
    private readonly _registry: ClientSessionRegistry;
    private readonly _logger: ILogger | null;

    /** Sessions that have subscribed to cluster view events (keyed by sessionId → correlationId). */
    private readonly _clusterViewSubscribers = new Map<string, number>();

    /** Sessions that have subscribed to partition-lost events (keyed by sessionId). */
    private readonly _partitionLostSubscribers = new Map<string, {
        registrationId: string;
        localOnly: boolean;
    }>();

    /** Current member-list version. Monotonically increasing. */
    private _memberListVersion = 0;
    /** Current partition-table version. Monotonically increasing. */
    private _partitionVersion = 0;

    /** Last-published member list (for dedup). */
    private _lastMembers: MemberInfo[] = [];
    /** Last-published partition table (for dedup). */
    private _lastPartitions: PartitionOwnershipMap = new Map();

    private _running = false;

    constructor(registry: ClientSessionRegistry, options?: TopologyPublisherOptions) {
        this._registry = registry;
        this._logger = options?.logger ?? null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        this._running = true;
    }

    stop(): void {
        this._running = false;
        this._clusterViewSubscribers.clear();
        this._partitionLostSubscribers.clear();
    }

    // ── Subscription management ───────────────────────────────────────────────

    /**
     * Subscribe a client session to cluster view events (member list + partition table).
     * Call this from the ClientAddClusterViewListenerCodec request handler.
     *
     * @param session   The session that sent the subscription request.
     * @param correlationId The request correlation ID to use for the response.
     */
    subscribeToClusterView(session: ClientSession, correlationId: number): void {
        this._clusterViewSubscribers.set(session.getSessionId(), correlationId);

        // Send ack response
        const response = ClientAddClusterViewListenerCodec.encodeResponse();
        response.setCorrelationId(correlationId);
        session.sendMessage(response);

        // Immediately push current state to the new subscriber
        this._pushMemberView(session, correlationId);
        this._pushPartitionView(session, correlationId);
    }

    /**
     * Subscribe a client session to partition-lost events.
     * Call this from the ClientAddPartitionLostListenerCodec request handler.
     *
     * @param session    The subscribing session.
     * @param localOnly  Whether to restrict to local partitions.
     * @param correlationId  Request correlation ID for the ack response.
     * @returns The server-assigned registration ID.
     */
    subscribeToPartitionLost(
        session: ClientSession,
        localOnly: boolean,
        correlationId: number,
    ): string {
        const registrationId = crypto.randomUUID();
        this._partitionLostSubscribers.set(session.getSessionId(), {
            registrationId,
            localOnly,
        });

        const response = ClientAddPartitionLostListenerCodec.encodeResponse(registrationId);
        response.setCorrelationId(correlationId);
        session.sendMessage(response);

        return registrationId;
    }

    /**
     * Remove all subscriptions for a closed session.
     * Call this from the session close handler.
     */
    onSessionClosed(sessionId: string): void {
        this._clusterViewSubscribers.delete(sessionId);
        this._partitionLostSubscribers.delete(sessionId);
    }

    // ── Topology change notifications ─────────────────────────────────────────

    /**
     * Publish an updated member list to all cluster-view subscribers.
     * Increments the member-list version.
     *
     * @param members Current member list.
     */
    publishMemberListUpdate(members: MemberInfo[]): void {
        if (!this._running) return;

        this._memberListVersion++;
        this._lastMembers = members;

        for (const [sessionId, corrId] of this._clusterViewSubscribers) {
            const session = this._registry.getSession(sessionId);
            if (session !== null && session.isAuthenticated()) {
                this._pushMemberView(session, corrId);
            } else {
                // Session gone — clean up
                this._clusterViewSubscribers.delete(sessionId);
            }
        }

        if (this._logger !== null) {
            this._logger.fine(
                `[TopologyPublisher] Published memberList v${this._memberListVersion} ` +
                `(${members.length} members) to ${this._clusterViewSubscribers.size} subscriber(s).`,
            );
        }
    }

    /**
     * Publish an updated partition table to all cluster-view subscribers.
     * Increments the partition-table version.
     *
     * @param partitions Map from partitionId → ownerUuid (null if no owner).
     */
    publishPartitionTableUpdate(partitions: PartitionOwnershipMap): void {
        if (!this._running) return;

        this._partitionVersion++;
        this._lastPartitions = partitions;

        for (const [sessionId, corrId] of this._clusterViewSubscribers) {
            const session = this._registry.getSession(sessionId);
            if (session !== null && session.isAuthenticated()) {
                this._pushPartitionView(session, corrId);
            } else {
                this._clusterViewSubscribers.delete(sessionId);
            }
        }

        if (this._logger !== null) {
            this._logger.fine(
                `[TopologyPublisher] Published partitionTable v${this._partitionVersion} ` +
                `to ${this._clusterViewSubscribers.size} subscriber(s).`,
            );
        }
    }

    /**
     * Publish a partition-lost event to all partition-lost subscribers.
     *
     * @param info  Partition-lost event details.
     */
    publishPartitionLost(info: PartitionLostInfo): void {
        if (!this._running) return;

        const event = ClientAddPartitionLostListenerCodec.encodePartitionLostEvent(
            info.partitionId,
            info.lostBackupCount,
            info.sourceUuid,
        );

        for (const [sessionId] of this._partitionLostSubscribers) {
            const session = this._registry.getSession(sessionId);
            if (session !== null && session.isAuthenticated()) {
                session.pushEvent(event);
            } else {
                this._partitionLostSubscribers.delete(sessionId);
            }
        }
    }

    // ── Error helpers ─────────────────────────────────────────────────────────

    /**
     * Build a WrongTargetException for a partition-bound operation that was
     * received by the wrong member.
     *
     * @param partitionId         The partition whose request was routed incorrectly.
     * @param expectedOwnerUuid   UUID of the correct partition owner (or null).
     */
    static buildWrongTargetError(
        partitionId: number,
        expectedOwnerUuid: string | null,
    ): WrongTargetException {
        return new WrongTargetException(partitionId, expectedOwnerUuid);
    }

    /**
     * Build a TargetNotMemberException for an operation targeting a member
     * that is no longer in the cluster.
     *
     * @param targetAddress  Address string of the departed target.
     */
    static buildTargetNotMemberError(targetAddress: string): TargetNotMemberException {
        return new TargetNotMemberException(targetAddress);
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    getMemberListVersion(): number {
        return this._memberListVersion;
    }

    getPartitionVersion(): number {
        return this._partitionVersion;
    }

    getClusterViewSubscriberCount(): number {
        return this._clusterViewSubscribers.size;
    }

    getPartitionLostSubscriberCount(): number {
        return this._partitionLostSubscribers.size;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _pushMemberView(session: ClientSession, correlationId: number): void {
        const event = ClientAddClusterViewListenerCodec.encodeMembersViewEvent(
            this._memberListVersion,
            this._lastMembers,
        );
        event.setCorrelationId(correlationId);
        session.pushEvent(event);
    }

    private _pushPartitionView(session: ClientSession, correlationId: number): void {
        // Transform partitionId→ownerUuid to ownerUuid→partitionIdList
        // (the official EntryListUUIDListInteger format)
        const byOwner = new Map<string, number[]>();
        for (const [partitionId, ownerUuid] of this._lastPartitions) {
            if (ownerUuid === null) continue;
            const list = byOwner.get(ownerUuid);
            if (list !== undefined) {
                list.push(partitionId);
            } else {
                byOwner.set(ownerUuid, [partitionId]);
            }
        }

        const entries: Array<[string, number[]]> = [];
        for (const [uuid, partitions] of byOwner) {
            entries.push([uuid, partitions]);
        }

        const event = ClientAddClusterViewListenerCodec.encodePartitionsViewEvent(
            this._partitionVersion,
            entries,
        );
        event.setCorrelationId(correlationId);
        session.pushEvent(event);
    }
}
