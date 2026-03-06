/**
 * Port of {@code com.hazelcast.internal.networking.InboundHandler}.
 */
import { ChannelHandler } from '@zenystx/core/internal/networking/ChannelHandler';
import type { HandlerStatus } from '@zenystx/core/internal/networking/HandlerStatus';

export abstract class InboundHandler<S, D> extends ChannelHandler<S, D> {
    abstract onRead(): HandlerStatus | Promise<HandlerStatus> | void;

    protected initSrcBuffer(sizeBytes?: number): void {
        // Stub: in tests, src is set directly.
    }
}
