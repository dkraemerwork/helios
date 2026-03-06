/**
 * Resolves the routable advertise host for Blitz multi-node deployments.
 *
 * Hazelcast parity: mirrors DefaultAddressPicker's separation of
 * publicAddress (advertise) vs bindAddress, with routability detection
 * for loopback and wildcard addresses.
 */

export interface AdvertiseHostInput {
  readonly advertiseHost?: string;
  readonly bindHost?: string;
}

export interface AdvertiseHostResult {
  readonly advertiseHost: string;
  readonly isRoutable: boolean;
}

const NON_ROUTABLE = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::"]);

/**
 * Resolve the effective advertise host and determine routability.
 *
 * Rules:
 * 1. Explicit `advertiseHost` always wins (like Hazelcast publicAddress).
 * 2. Falls back to `bindHost` if no advertise is set.
 * 3. Defaults to "127.0.0.1" if neither is set.
 * 4. Loopback/wildcard addresses are flagged as non-routable.
 * 5. DNS names and non-loopback IPs are considered routable.
 */
export function resolveAdvertiseHost(input: AdvertiseHostInput): AdvertiseHostResult {
  const advertiseHost = input.advertiseHost ?? input.bindHost ?? "127.0.0.1";
  const isRoutable = !NON_ROUTABLE.has(advertiseHost);

  return { advertiseHost, isRoutable };
}
