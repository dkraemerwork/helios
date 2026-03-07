/**
 * Member-side distributed-object metadata task for the client protocol.
 *
 * Handles requests from remote clients to query distributed object metadata.
 */
import type { ClientProtocolServer } from "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer";

/** Message type for distributed object metadata requests. */
export const DISTRIBUTED_OBJECT_REQUEST_TYPE = 0x000600;

export function registerDistributedObjectTask(server: ClientProtocolServer): void {
    server.registerHandler(DISTRIBUTED_OBJECT_REQUEST_TYPE, async (_msg, _session) => {
        // Placeholder: real implementation will serialize and return
        // distributed object metadata (service name, object name, etc.)
        return null;
    });
}
