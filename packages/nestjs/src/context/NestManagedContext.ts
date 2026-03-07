/**
 * {@link ManagedContext} implementation for NestJS.
 * Port of {@code com.hazelcast.spring.context.SpringManagedContext}.
 *
 * Objects annotated with {@link NestAware} have their dependencies resolved
 * via a NestJS {@code ModuleRef} set on this context.
 */

import type { ModuleRef } from '@nestjs/core';
import type { ManagedContext } from '@zenystx/helios-core/spi/impl/ManagedContext';

export class NestManagedContext implements ManagedContext {
    private _moduleRef: ModuleRef | null;

    constructor(moduleRef?: ModuleRef) {
        this._moduleRef = moduleRef ?? null;
    }

    /** Set (or replace) the ModuleRef after construction. */
    setModuleRef(moduleRef: ModuleRef): void {
        this._moduleRef = moduleRef;
    }

    /**
     * Initialize the given object.
     * If the object is {@link NestAware} and a ModuleRef is available,
     * the context is ready for dependency injection via {@link inject}.
     * Returns the (same) object reference.
     */
    initialize(obj: unknown): unknown {
        if (obj == null) return obj;
        if (typeof obj !== 'object') return obj;
        // @NestAware objects are recognized; injection is opt-in via inject()
        return obj;
    }

    /**
     * Inject a dependency into a property of a target object.
     * Resolves the token from the current ModuleRef and sets it on `propertyKey`.
     *
     * @param target      Object to inject into
     * @param token       NestJS injection token
     * @param propertyKey Property name on the target to receive the resolved value
     */
    inject(target: object, token: unknown, propertyKey: string): void {
        if (this._moduleRef == null) return;
        const value = this._moduleRef.get(token as never, { strict: false });
        (target as Record<string, unknown>)[propertyKey] = value;
    }
}
