/**
 * Member-side listener registration/removal task for the client protocol.
 *
 * Handles requests from remote clients to register and remove event listeners.
 */
import type { ClientProtocolServer } from "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer";

/** Message type for listener registration requests. */
export const LISTENER_REGISTER_REQUEST_TYPE = 0x000500;
/** Message type for listener removal requests. */
export const LISTENER_REMOVE_REQUEST_TYPE = 0x000501;

export function registerListenerTask(server: ClientProtocolServer): void {
    server.registerHandler(LISTENER_REGISTER_REQUEST_TYPE, async (_msg, _session) => {
        // Placeholder: real implementation will register the listener and return
        // a registration ID to the client
        return null;
    });

    server.registerHandler(LISTENER_REMOVE_REQUEST_TYPE, async (_msg, _session) => {
        // Placeholder: real implementation will remove the listener by registration ID
        return null;
    });
}
