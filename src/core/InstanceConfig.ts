/**
 * Shared config contract for both member and client instances.
 *
 * Port of the Hazelcast pattern where HazelcastInstance.getConfig() returns
 * Config (for members) or ClientDynamicClusterConfig (for clients).
 *
 * In Helios, HeliosInstance.getConfig() returns InstanceConfig, which is
 * satisfied by both HeliosConfig (member) and ClientConfig (client).
 */
export interface InstanceConfig {
  /** Returns the name of the config / instance. */
  getName(): string;
}
