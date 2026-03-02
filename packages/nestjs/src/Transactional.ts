/**
 * \@Transactional() method decorator for Helios.
 *
 * Port of {@code org.springframework.transaction.annotation.Transactional}.
 *
 * Wraps an annotated method in a Helios transaction. The manager is resolved
 * with DI-first priority:
 *   1. If `this` has a property holding a {@link HeliosTransactionManager}
 *      instance (injected via NestJS constructor injection), that manager is used.
 *   2. Otherwise falls back to the globally registered manager
 *      ({@link HeliosTransactionManager.getCurrent}).
 *
 * This allows multiple independent modules/instances to each have their own
 * transaction manager without global-singleton interference.
 *
 * Supports:
 *   - \@Transactional()              — REQUIRED propagation, manager default timeout
 *   - \@Transactional({ timeout: N }) — N-second timeout (overrides manager default)
 *   - \@Transactional({ propagation: Propagation.REQUIRES_NEW }) — throws if nested
 */

import { HeliosTransactionManager, type TransactionalRunOptions } from './HeliosTransactionManager';

// ---------------------------------------------------------------------------
// DI-based manager resolution
// ---------------------------------------------------------------------------

/**
 * Scans own enumerable properties of `instance` for an injected
 * {@link HeliosTransactionManager}. Returns the first one found, or `null`.
 *
 * This enables DI-based resolution: if a NestJS service declares
 * `constructor(private readonly txMgr: HeliosTransactionManager)`,
 * the `@Transactional()` decorator picks up that injected manager
 * rather than the global static singleton.
 */
function findManagerOnInstance(instance: unknown): HeliosTransactionManager | null {
    if (instance == null || typeof instance !== 'object') return null;
    for (const key of Object.keys(instance as object)) {
        const val = (instance as Record<string, unknown>)[key];
        if (val instanceof HeliosTransactionManager) return val;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Propagation enum
// ---------------------------------------------------------------------------

export const Propagation = {
    REQUIRED: 'REQUIRED',
    REQUIRES_NEW: 'REQUIRES_NEW',
} as const;
export type Propagation = (typeof Propagation)[keyof typeof Propagation];

// ---------------------------------------------------------------------------
// TransactionalOptions
// ---------------------------------------------------------------------------

export interface TransactionalOptions {
    /** Timeout in seconds. Overrides the manager's default timeout. */
    timeout?: number;
    /** Propagation behaviour. Defaults to REQUIRED. */
    propagation?: Propagation;
}

// ---------------------------------------------------------------------------
// @Transactional() decorator
// ---------------------------------------------------------------------------

/**
 * Wraps a class method in a Helios transaction.
 *
 * The globally registered {@link HeliosTransactionManager} is used.
 * Must be used on methods of classes that are created after calling
 * {@link HeliosTransactionManager.setCurrent} (or via HeliosTransactionModule).
 */
export function Transactional(options?: TransactionalOptions): MethodDecorator {
    return function (
        _target: object,
        _propertyKey: string | symbol,
        descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
        const originalMethod = descriptor.value as (...args: unknown[]) => unknown;

        descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
            // DI-first: prefer an injected manager on `this` over the global static.
            const mgr = findManagerOnInstance(this) ?? HeliosTransactionManager.getCurrent();
            if (!mgr) {
                // No manager available — execute without transaction wrapping.
                // This should not happen in a properly configured NestJS module.
                return originalMethod.apply(this, args);
            }

            const runOptions: TransactionalRunOptions = {};
            if (options?.timeout !== undefined) {
                runOptions.timeout = options.timeout;
            }
            if (options?.propagation !== undefined) {
                runOptions.propagation = options.propagation;
            }

            return mgr.run(() => originalMethod.apply(this, args) as Promise<unknown>, runOptions);
        };

        return descriptor;
    };
}
