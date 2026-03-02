/**
 * Port of {@code com.hazelcast.internal.networking.OutboundFrame}.
 * Represents a payload that can be written to a Channel.
 */
export interface OutboundFrame {
    isUrgent(): boolean;
    getFrameLength(): number;
}
