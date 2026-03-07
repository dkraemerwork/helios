/**
 * P20-RELIABLE-TOPIC — NOT-RETAINED
 *
 * getReliableTopic() was narrowed out of the remote client surface in Block 20.5/20.7.
 * See CLIENT_E2E_PARITY_MATRIX row: reliable-topic -> blocked-by-server / deferred.
 * See DEFERRED_CLIENT_FEATURES which includes 'reliable-topic-client'.
 *
 * This file exists to satisfy the proof-label contract requirement that every
 * mandatory label has a named test file owner.
 */
import { describe, test, expect } from "bun:test";

describe("P20-RELIABLE-TOPIC — NOT-RETAINED", () => {
    test("getReliableTopic() is not on HeliosClient (narrowed out)", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        expect("getReliableTopic" in HeliosClient.prototype).toBe(false);
    });

    test("DEFERRED_CLIENT_FEATURES includes reliable-topic-client", async () => {
        const { DEFERRED_CLIENT_FEATURES } = await import("@zenystx/helios-core/client/HeliosClient");
        expect(DEFERRED_CLIENT_FEATURES).toContain("reliable-topic-client");
    });
});
