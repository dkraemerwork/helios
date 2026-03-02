/**
 * Injection token for the HeliosInstance provider.
 * Port of {@code com.hazelcast.spring.HazelcastInstanceDefinitionParser}.
 *
 * Usage:
 *   @Inject(HELIOS_INSTANCE_TOKEN) private hz: HeliosInstance
 */
export const HELIOS_INSTANCE_TOKEN = 'HELIOS_INSTANCE' as const;
