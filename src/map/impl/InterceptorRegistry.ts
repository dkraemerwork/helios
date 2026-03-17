/**
 * Port of {@code com.hazelcast.map.impl.InterceptorRegistry}.
 *
 * Per-map registry for MapInterceptor instances. Uses copy-on-write lists
 * for thread safety during iteration. Interceptors are identified by string IDs.
 */
import type { MapInterceptor } from '@zenystx/helios-core/map/MapInterceptor';

export class InterceptorRegistry {
    private _interceptors: readonly MapInterceptor[] = [];
    private _idToInterceptor: ReadonlyMap<string, MapInterceptor> = new Map();

    /**
     * Register an interceptor with the given ID. Replaces existing
     * interceptor with the same ID. Copy-on-write semantics.
     */
    register(id: string, interceptor: MapInterceptor): void {
        const newMap = new Map(this._idToInterceptor);
        newMap.set(id, interceptor);
        this._idToInterceptor = newMap;
        this._interceptors = [...newMap.values()];
    }

    /**
     * Deregister an interceptor by ID. Returns true if removed.
     */
    deregister(id: string): boolean {
        if (!this._idToInterceptor.has(id)) return false;
        const newMap = new Map(this._idToInterceptor);
        newMap.delete(id);
        this._idToInterceptor = newMap;
        this._interceptors = [...newMap.values()];
        return true;
    }

    getInterceptors(): readonly MapInterceptor[] {
        return this._interceptors;
    }

    hasInterceptors(): boolean {
        return this._interceptors.length > 0;
    }

    getInterceptor(id: string): MapInterceptor | null {
        return this._idToInterceptor.get(id) ?? null;
    }
}
