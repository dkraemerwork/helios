/**
 * MulticastJoiner — discovers cluster master via UDP multicast and initiates TCP join.
 *
 * Port of {@code com.hazelcast.internal.cluster.impl.MulticastJoiner}.
 *
 * Protocol:
 * 1. Node broadcasts a JOIN_REQUEST via multicast at randomized intervals (50–200ms)
 * 2. If a master receives the request, it responds with a JOIN message containing its address
 * 3. If no master is found within the timeout, the node declares itself master
 * 4. Once a master address is discovered, the node initiates a TCP connection to the master
 *    and uses the existing TCP join protocol (JOIN_REQUEST → FINALIZE_JOIN)
 *
 * This bridges multicast discovery with the existing TCP cluster transport.
 */
import type { MulticastJoinMessage, MulticastJoinRequest, MulticastListener, MulticastMessage, MulticastService } from '@zenystx/helios-core/cluster/multicast/MulticastService';
import type { MulticastConfig } from '@zenystx/helios-core/config/MulticastConfig';

// ── Constants ─────────────────────────────────────────────────────────────

/** Minimum publish interval between multicast join requests (ms). */
const PUBLISH_INTERVAL_MIN = 50;

/** Maximum publish interval between multicast join requests (ms). */
const PUBLISH_INTERVAL_MAX = 200;

/** Modulo used to vary try count based on address/port. */
const TRY_COUNT_MODULO = 10;

// ── Types ─────────────────────────────────────────────────────────────────

export interface MulticastJoinerConfig {
    /** The multicast config (group, port, timeout, etc.) */
    readonly multicastConfig: MulticastConfig;
    /** The multicast service (must be started before calling join) */
    readonly multicastService: MulticastService;
    /** This node's TCP address (host:port for the TCP cluster transport) */
    readonly localAddress: { readonly host: string; readonly port: number };
    /** This node's UUID */
    readonly localUuid: string;
    /** Cluster name for config validation */
    readonly clusterName: string;
    /** Number of partitions */
    readonly partitionCount: number;
    /** Member version */
    readonly version: { readonly major: number; readonly minor: number; readonly patch: number };
    /** Whether this is a lite member */
    readonly liteMember?: boolean;
}

export interface MulticastJoinResult {
    /** Whether a master was discovered (false = this node became master) */
    readonly masterFound: boolean;
    /** The discovered master address (null if this node is master) */
    readonly masterAddress: { readonly host: string; readonly port: number } | null;
    /** The master's UUID (null if this node is master) */
    readonly masterUuid: string | null;
}

// ── NodeMulticastListener ─────────────────────────────────────────────────

/**
 * Port of {@code com.hazelcast.internal.cluster.impl.NodeMulticastListener}.
 *
 * Handles incoming multicast messages during the join phase:
 * - JOIN (non-request): Potential master announcing itself — record its address
 * - JOIN (request): Another node looking for master — if we're master, respond
 */
class NodeMulticastListener implements MulticastListener {
    private _masterAddress: { host: string; port: number } | null = null;
    private _masterUuid: string | null = null;
    private readonly _localUuid: string;
    private readonly _localAddress: { host: string; port: number };
    private readonly _clusterName: string;
    private readonly _multicastService: MulticastService;
    private _isMaster = false;
    private _isJoined = false;
    private _joinResponse: MulticastJoinMessage | null = null;

    constructor(
        localUuid: string,
        localAddress: { host: string; port: number },
        clusterName: string,
        multicastService: MulticastService,
    ) {
        this._localUuid = localUuid;
        this._localAddress = localAddress;
        this._clusterName = clusterName;
        this._multicastService = multicastService;
    }

    onMessage(msg: MulticastMessage): void {
        if (msg.type !== 'JOIN') return;

        const joinMsg = msg as MulticastJoinMessage;

        // Ignore messages from self
        if (joinMsg.uuid === this._localUuid) return;

        // Ignore messages from different clusters
        if (joinMsg.clusterName !== this._clusterName) return;

        if (this._isMaster && this._isJoined) {
            // We're master and already joined — respond to join requests
            if (isJoinRequest(joinMsg)) {
                this._multicastService.send(this._joinResponse!);
            }
            return;
        }

        if (!this._isJoined && this._masterAddress === null) {
            // Not yet joined and no master known — accept this as potential master
            if (!isJoinRequest(joinMsg)) {
                this._masterAddress = { ...joinMsg.address };
                this._masterUuid = joinMsg.uuid;
            }
        }
    }

    getMasterAddress(): { host: string; port: number } | null {
        return this._masterAddress;
    }

    getMasterUuid(): string | null {
        return this._masterUuid;
    }

    clearMaster(): void {
        this._masterAddress = null;
        this._masterUuid = null;
    }

    setMaster(isMaster: boolean): void {
        this._isMaster = isMaster;
    }

    setJoined(isJoined: boolean): void {
        this._isJoined = isJoined;
    }

    setJoinResponse(response: MulticastJoinMessage): void {
        this._joinResponse = response;
    }
}

function isJoinRequest(msg: MulticastJoinMessage): msg is MulticastJoinRequest {
    return 'isRequest' in msg && (msg as MulticastJoinRequest).isRequest === true;
}

// ── MulticastJoiner ───────────────────────────────────────────────────────

export class MulticastJoiner {
    private readonly _config: MulticastJoinerConfig;
    private readonly _listener: NodeMulticastListener;
    private _running = true;

    constructor(config: MulticastJoinerConfig) {
        this._config = config;
        this._listener = new NodeMulticastListener(
            config.localUuid,
            config.localAddress,
            config.clusterName,
            config.multicastService,
        );

        // Register the listener on the multicast service
        config.multicastService.addMulticastListener(this._listener);

        // Prepare the join response for when this node becomes master
        this._listener.setJoinResponse({
            type: 'JOIN',
            address: config.localAddress,
            uuid: config.localUuid,
            clusterName: config.clusterName,
            partitionCount: config.partitionCount,
            version: config.version,
            liteMember: config.liteMember ?? false,
        });
    }

    /**
     * Perform multicast-based master discovery.
     *
     * Broadcasts JOIN_REQUEST messages and waits for a master to respond.
     * If no master is found within the configured timeout, returns with
     * masterFound=false (caller should declare self as master).
     *
     * Port of {@code MulticastJoiner.doJoin()} / {@code findMasterWithMulticast()}.
     */
    async join(): Promise<MulticastJoinResult> {
        const maxTryCount = this._calculateTryCount();
        let currentTry = 0;

        while (this._running && currentTry < maxTryCount) {
            currentTry++;

            // Clear any previous master address
            this._listener.clearMaster();

            // Broadcast a join request
            const joinRequest: MulticastJoinRequest = {
                type: 'JOIN',
                isRequest: true,
                tryCount: currentTry,
                address: this._config.localAddress,
                uuid: this._config.localUuid,
                clusterName: this._config.clusterName,
                partitionCount: this._config.partitionCount,
                version: this._config.version,
                liteMember: this._config.liteMember ?? false,
            };

            this._config.multicastService.send(joinRequest);

            // Wait a randomized interval
            await sleep(getPublishInterval());

            // Check if a master was discovered
            const masterAddress = this._listener.getMasterAddress();
            if (masterAddress !== null) {
                return {
                    masterFound: true,
                    masterAddress,
                    masterUuid: this._listener.getMasterUuid(),
                };
            }
        }

        // No master found — this node should become master
        return {
            masterFound: false,
            masterAddress: null,
            masterUuid: null,
        };
    }

    /**
     * Mark this node as joined master so it responds to future join requests.
     */
    setAsMaster(): void {
        this._listener.setMaster(true);
        this._listener.setJoined(true);
    }

    /**
     * Mark this node as joined (non-master).
     */
    setJoined(): void {
        this._listener.setJoined(true);
    }

    /**
     * Stop the joiner and remove the listener.
     */
    stop(): void {
        this._running = false;
        this._config.multicastService.removeMulticastListener(this._listener);
    }

    /**
     * Get the internal listener (for testing).
     */
    getListener(): MulticastListener {
        return this._listener;
    }

    /**
     * Calculate the number of multicast tries based on timeout config.
     *
     * Port of {@code MulticastJoiner.calculateTryCount()}.
     */
    private _calculateTryCount(): number {
        const timeoutMs = this._config.multicastConfig.getMulticastTimeoutSeconds() * 1000;
        const avgInterval = (PUBLISH_INTERVAL_MAX + PUBLISH_INTERVAL_MIN) / 2;
        let tryCount = Math.floor(timeoutMs / avgInterval);

        // Add variation based on local address (last IP octet + port diff)
        const host = this._config.localAddress.host;
        const lastDot = host.lastIndexOf('.');
        let lastDigits: number;
        if (lastDot >= 0) {
            const parsed = parseInt(host.substring(lastDot + 1), 10);
            lastDigits = isNaN(parsed) ? Math.floor(Math.random() * 512) : parsed;
        } else {
            lastDigits = Math.floor(Math.random() * 512);
        }

        const portDiff = this._config.localAddress.port - 5701;
        tryCount += (lastDigits + portDiff) % TRY_COUNT_MODULO;

        return Math.max(tryCount, 1);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getPublishInterval(): number {
    return PUBLISH_INTERVAL_MIN + Math.floor(
        Math.random() * (PUBLISH_INTERVAL_MAX - PUBLISH_INTERVAL_MIN),
    );
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
