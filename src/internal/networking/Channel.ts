/**
 * Port of {@code com.hazelcast.internal.networking.Channel}.
 * A Channel is a construct that can send/receive Packets/ClientMessages.
 */
import type { OutboundFrame } from '@zenystx/helios-core/internal/networking/OutboundFrame';

export interface Channel {
    write(frame: OutboundFrame): boolean;
    close(): void;
    isClosed(): boolean;
    isClientMode(): boolean;
    lastReadTimeMillis(): number;
    lastWriteTimeMillis(): number;
    bytesRead(): number;
    bytesWritten(): number;
    start(): void;
}
