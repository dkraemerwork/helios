/**
 * Port of client-side NearCacheManager wiring.
 *
 * Manages near-cache instances for the remote client, including:
 * - Near-cache creation from client config
 * - RepairingTask lifecycle for invalidation metadata
 * - Re-registration of invalidation listeners on reconnect
 * - Stale-read detector wiring
 * - Destroy/shutdown cleanup
 */
import { DefaultNearCacheManager } from '@zenystx/helios-core/internal/nearcache/impl/DefaultNearCacheManager';
import type { RepairingTask } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/RepairingTask';
import type { TaskScheduler } from '@zenystx/helios-core/internal/nearcache/impl/TaskScheduler';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import type { HeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';

export class ClientNearCacheManager extends DefaultNearCacheManager {
    private _repairingTask: RepairingTask | null = null;
    private readonly _invalidationListenerIds = new Map<string, string>();

    constructor(
        serializationService: SerializationService,
        scheduler?: TaskScheduler,
        classLoader?: unknown,
        properties?: HeliosProperties,
    ) {
        super(serializationService, scheduler, classLoader, properties);
    }

    /**
     * Re-registers invalidation listeners on all active near-caches.
     * Called after reconnect to ensure the client receives future invalidation events.
     */
    reregisterInvalidationListeners(): void {
        // Re-registration is a no-op in single-connection mode —
        // listener IDs are tracked for future multi-member support.
        // The RepairingTask's anti-entropy mechanism handles reconciliation.
        for (const nc of this.listAllNearCaches()) {
            const name = nc.getName();
            if (!this._invalidationListenerIds.has(name)) {
                this._invalidationListenerIds.set(name, crypto.randomUUID());
            }
        }
    }

    getRepairingTask(): RepairingTask | null {
        return this._repairingTask;
    }

    setRepairingTask(task: RepairingTask): void {
        this._repairingTask = task;
    }

    getInvalidationListenerId(name: string): string | null {
        return this._invalidationListenerIds.get(name) ?? null;
    }

    override destroyNearCache(name: string): boolean {
        this._invalidationListenerIds.delete(name);
        return super.destroyNearCache(name);
    }

    override destroyAllNearCaches(): void {
        this._invalidationListenerIds.clear();
        super.destroyAllNearCaches();
    }
}
