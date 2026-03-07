/**
 * Member-side partition metadata task for the client protocol.
 *
 * Handles requests from remote clients to receive the current partition table.
 */
import type { ClientProtocolServer } from "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer";

/** Message type for partition metadata requests. */
export const PARTITION_REQUEST_TYPE = 0x000400;

export function registerPartitionTask(server: ClientProtocolServer): void {
    server.registerHandler(PARTITION_REQUEST_TYPE, async (_msg, _session) => {
        // Placeholder: real implementation will serialize and return
        // the current partition ownership table and version
        return null;
    });
}
