/**
 * Port of interceptor support from {@code com.hazelcast.map.impl.MapServiceContextImpl}.
 * Provides centralized interceptor invocation for all map CRUD operations.
 */
import type { MapInterceptor } from '@zenystx/helios-core/map/MapInterceptor';
import { InterceptorRegistry } from '@zenystx/helios-core/map/impl/InterceptorRegistry';

export class MapInterceptorSupport {
    /** Per-map interceptor registries. */
    private readonly _registries = new Map<string, InterceptorRegistry>();

    getOrCreateRegistry(mapName: string): InterceptorRegistry {
        let registry = this._registries.get(mapName);
        if (!registry) {
            registry = new InterceptorRegistry();
            this._registries.set(mapName, registry);
        }
        return registry;
    }

    getRegistry(mapName: string): InterceptorRegistry | null {
        return this._registries.get(mapName) ?? null;
    }

    /**
     * Generate a deterministic interceptor ID from the interceptor object.
     * Matches Hazelcast's pattern: className + hashCode.
     */
    generateInterceptorId(interceptor: MapInterceptor): string {
        const name = interceptor.constructor?.name ?? 'MapInterceptor';
        let hash = 0;
        const str = JSON.stringify(interceptor);
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return `${name}@${hash.toString(16)}`;
    }

    addInterceptor(mapName: string, id: string, interceptor: MapInterceptor): void {
        this.getOrCreateRegistry(mapName).register(id, interceptor);
    }

    removeInterceptor(mapName: string, id: string): boolean {
        const registry = this._registries.get(mapName);
        if (!registry) return false;
        return registry.deregister(id);
    }

    /**
     * Intercept a GET operation. Returns the (possibly replaced) value.
     */
    interceptGet(mapName: string, value: unknown): unknown {
        const registry = this._registries.get(mapName);
        if (!registry || !registry.hasInterceptors()) return value;

        let result = value;
        for (const interceptor of registry.getInterceptors()) {
            const replacement = interceptor.interceptGet(result);
            if (replacement !== null && replacement !== undefined) {
                result = replacement;
            }
        }
        return result;
    }

    /**
     * Fire after-GET callbacks.
     */
    interceptAfterGet(mapName: string, value: unknown): void {
        const registry = this._registries.get(mapName);
        if (!registry || !registry.hasInterceptors()) return;

        for (const interceptor of registry.getInterceptors()) {
            interceptor.afterGet(value);
        }
    }

    /**
     * Intercept a PUT operation. Returns the (possibly replaced) new value.
     */
    interceptPut(mapName: string, oldValue: unknown, newValue: unknown): unknown {
        const registry = this._registries.get(mapName);
        if (!registry || !registry.hasInterceptors()) return newValue;

        let result = newValue;
        for (const interceptor of registry.getInterceptors()) {
            const replacement = interceptor.interceptPut(oldValue, result);
            if (replacement !== null && replacement !== undefined) {
                result = replacement;
            }
        }
        return result;
    }

    /**
     * Fire after-PUT callbacks.
     */
    interceptAfterPut(mapName: string, value: unknown): void {
        const registry = this._registries.get(mapName);
        if (!registry || !registry.hasInterceptors()) return;

        for (const interceptor of registry.getInterceptors()) {
            interceptor.afterPut(value);
        }
    }

    /**
     * Intercept a REMOVE operation. Returns the (possibly replaced) removed value.
     */
    interceptRemove(mapName: string, removedValue: unknown): unknown {
        const registry = this._registries.get(mapName);
        if (!registry || !registry.hasInterceptors()) return removedValue;

        let result = removedValue;
        for (const interceptor of registry.getInterceptors()) {
            const replacement = interceptor.interceptRemove(result);
            if (replacement !== null && replacement !== undefined) {
                result = replacement;
            }
        }
        return result;
    }

    /**
     * Fire after-REMOVE callbacks.
     */
    interceptAfterRemove(mapName: string, value: unknown): void {
        const registry = this._registries.get(mapName);
        if (!registry || !registry.hasInterceptors()) return;

        for (const interceptor of registry.getInterceptors()) {
            interceptor.afterRemove(value);
        }
    }

    destroyMap(mapName: string): void {
        this._registries.delete(mapName);
    }
}
