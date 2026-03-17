/**
 * Port of {@code com.hazelcast.projection.Projection}.
 *
 * Enables transforming objects into other objects.
 * Exemplary usage scenario is the project() method of the IMap.
 *
 * Only 1:1 transformations allowed. Use an Aggregator to perform N:1 or N:M aggregations.
 *
 * @since 3.8
 */
export interface Projection<I, O> {
    /**
     * Transforms the input object into the output object.
     *
     * @param input object.
     * @return the output object.
     */
    transform(input: I): O;
}
