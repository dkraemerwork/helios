/**
 * Port of {@code com.hazelcast.projection.Projections}.
 *
 * A utility class to create basic {@link Projection} instances.
 *
 * @since 3.8
 */
import type { Projection } from '@zenystx/helios-core/projection/Projection';
import { IdentityProjection } from '@zenystx/helios-core/projection/impl/IdentityProjection';
import { MultiAttributeProjection } from '@zenystx/helios-core/projection/impl/MultiAttributeProjection';
import { SingleAttributeProjection } from '@zenystx/helios-core/projection/impl/SingleAttributeProjection';

export class Projections {
    private constructor() {
        throw new Error('Projections is a utility class');
    }

    /**
     * Returns a projection that does no transformation.
     */
    static identity<T>(): Projection<T, T> {
        return IdentityProjection.INSTANCE as IdentityProjection<T>;
    }

    /**
     * Returns a projection that extracts the value of the given attributePath.
     *
     * @param attributePath single attribute path, must not be null or empty
     */
    static singleAttribute<I, O = unknown>(attributePath: string): Projection<I, O> {
        return new SingleAttributeProjection<I, O>(attributePath);
    }

    /**
     * Returns a projection that extracts the value of the given attributePaths.
     * The attribute values will be returned as an array from each projection call.
     *
     * @param attributePaths attribute paths, must not be null or empty
     */
    static multiAttribute<I>(...attributePaths: string[]): Projection<I, unknown[]> {
        return new MultiAttributeProjection<I>(...attributePaths);
    }
}
