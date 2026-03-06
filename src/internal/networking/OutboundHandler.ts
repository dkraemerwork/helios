/**
 * Port of {@code com.hazelcast.internal.networking.OutboundHandler}.
 */
import { ChannelHandler } from '@zenystx/helios-core/internal/networking/ChannelHandler';
import type { HandlerStatus } from '@zenystx/helios-core/internal/networking/HandlerStatus';

export abstract class OutboundHandler<S, D> extends ChannelHandler<S, D> {
    abstract onWrite(): HandlerStatus;

    protected initDstBuffer(sizeBytes?: number): void {
        // Stub: in tests, dst is set directly.
    }
}
