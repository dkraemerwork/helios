/**
 * Discriminated-union message types for the Helios TCP cluster protocol.
 *
 * Wire format: [4-byte BE uint32: JSON length][JSON payload bytes]
 *
 * All messages carry a `type` discriminant so the receiver can switch on them.
 */

export interface HelloMsg {
    readonly type: 'HELLO';
    /** Logical node ID of the sender (instance name). */
    readonly nodeId: string;
}

export interface MapPutMsg {
    readonly type: 'MAP_PUT';
    readonly mapName: string;
    readonly key: unknown;
    readonly value: unknown;
}

export interface MapRemoveMsg {
    readonly type: 'MAP_REMOVE';
    readonly mapName: string;
    readonly key: unknown;
}

export interface MapClearMsg {
    readonly type: 'MAP_CLEAR';
    readonly mapName: string;
}

/** Near-cache invalidation: tells the peer to evict the cached entry for `key`. */
export interface InvalidateMsg {
    readonly type: 'INVALIDATE';
    readonly mapName: string;
    readonly key: unknown;
}

export type ClusterMessage =
    | HelloMsg
    | MapPutMsg
    | MapRemoveMsg
    | MapClearMsg
    | InvalidateMsg;
