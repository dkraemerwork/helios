/**
 * Member-side cluster view task for the client protocol.
 *
 * Handles requests from remote clients to receive the current cluster member list.
 */
import type { ClientProtocolServer } from "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer";

/** Message type for cluster view requests. */
export const CLUSTER_VIEW_REQUEST_TYPE = 0x000300;

export function registerClusterViewTask(server: ClientProtocolServer): void {
    server.registerHandler(CLUSTER_VIEW_REQUEST_TYPE, async (_msg, _session) => {
        // Placeholder: real implementation will serialize and return
        // the current cluster member list and version
        return null;
    });
}
