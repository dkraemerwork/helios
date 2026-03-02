/**
 * MapProxy subclass that replicates mutations to all connected TCP peers.
 *
 * Overrides the mutating methods (put / set / remove / clear) to:
 *  1. Apply the change locally (via super).
 *  2. Broadcast a MAP_PUT / MAP_REMOVE / MAP_CLEAR message to every peer.
 *  3. Broadcast an INVALIDATE message so peers can evict stale near-cache entries.
 *
 * Re-broadcast prevention:
 *  When the transport calls applyRemotePut / applyRemoteRemove / applyRemoteClear,
 *  it sets _fromRemote = true before calling the mutating method.  The overridden
 *  methods skip broadcasting while _fromRemote is true.  Since Bun is single-
 *  threaded there are no race conditions on this flag.
 */
import { MapProxy } from '@helios/map/impl/MapProxy';
import type { RecordStore } from '@helios/map/impl/recordstore/RecordStore';
import type { NodeEngine } from '@helios/spi/NodeEngine';
import type { MapContainerService } from '@helios/map/impl/MapContainerService';
import type { TcpClusterTransport } from '@helios/cluster/tcp/TcpClusterTransport';

export class NetworkedMapProxy<K, V> extends MapProxy<K, V> {
    private readonly _transport: TcpClusterTransport;
    /** True while applying a mutation that arrived from a remote peer. */
    private _fromRemote = false;

    constructor(
        name: string,
        store: RecordStore,
        nodeEngine: NodeEngine,
        containerService: MapContainerService,
        transport: TcpClusterTransport,
    ) {
        super(name, store, nodeEngine, containerService);
        this._transport = transport;
    }

    // ── Mutating overrides ────────────────────────────────────────────────

    override put(key: K, value: V): V | null {
        const old = super.put(key, value);
        if (!this._fromRemote) {
            this._transport.broadcastPut(this.getName(), key, value);
            this._transport.broadcastInvalidate(this.getName(), key);
        }
        return old;
    }

    override set(key: K, value: V): void {
        super.set(key, value);
        if (!this._fromRemote) {
            this._transport.broadcastPut(this.getName(), key, value);
            this._transport.broadcastInvalidate(this.getName(), key);
        }
    }

    override remove(key: K): V | null {
        const old = super.remove(key);
        if (!this._fromRemote) {
            this._transport.broadcastRemove(this.getName(), key);
            this._transport.broadcastInvalidate(this.getName(), key);
        }
        return old;
    }

    override clear(): void {
        super.clear();
        if (!this._fromRemote) {
            this._transport.broadcastClear(this.getName());
        }
    }

    // ── Remote-apply API (called by TcpClusterTransport) ─────────────────

    /**
     * Apply a put that originated on a remote peer.
     * Skips re-broadcasting so the change does not loop back.
     */
    applyRemotePut(key: K, value: V): void {
        this._fromRemote = true;
        try {
            this.put(key, value);
        } finally {
            this._fromRemote = false;
        }
    }

    /**
     * Apply a remove that originated on a remote peer.
     */
    applyRemoteRemove(key: K): void {
        this._fromRemote = true;
        try {
            this.remove(key);
        } finally {
            this._fromRemote = false;
        }
    }

    /**
     * Apply a clear that originated on a remote peer.
     */
    applyRemoteClear(): void {
        this._fromRemote = true;
        try {
            this.clear();
        } finally {
            this._fromRemote = false;
        }
    }
}
