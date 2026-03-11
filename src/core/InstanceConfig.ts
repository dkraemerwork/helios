/**
 * Minimal config contract exposed from a running Helios member instance.
 */
export interface InstanceConfig {
  /** Returns the name of the config / instance. */
  getName(): string;
}
