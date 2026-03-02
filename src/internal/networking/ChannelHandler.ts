/**
 * Port of {@code com.hazelcast.internal.networking.ChannelHandler}.
 * Base class for inbound and outbound channel handlers.
 *
 * Note: fields are named with underscore prefix to avoid collision with the
 * fluent setter methods `src()` and `dst()` that match the Java API.
 */
import type { Channel } from '@helios/internal/networking/Channel';

export abstract class ChannelHandler<S, D> {
    protected channel!: Channel;
    protected _src!: S;
    protected _dst!: D;

    /** Fluent setter for source (matches Java method naming used in tests). */
    src(s: S): this {
        this._src = s;
        return this;
    }

    /** Fluent setter for destination (matches Java method naming used in tests). */
    dst(d: D): this {
        this._dst = d;
        return this;
    }

    handlerAdded(): void {}
}
