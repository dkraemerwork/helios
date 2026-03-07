/**
 * Client-side executor service proxy.
 *
 * Provides a DistributedObject interface for remote executor services.
 * Full IExecutorService semantics are deferred to Block 20.7+.
 */
import { ClientProxy } from "@zenystx/helios-core/client/proxy/ClientProxy";

export class ClientExecutorProxy extends ClientProxy {
    isShutdown(): boolean {
        return this.isDestroyed();
    }
}
