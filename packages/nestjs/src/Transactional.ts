/**
 * \@Transactional() method decorator for Helios.
 *
 * Port of {@code org.springframework.transaction.annotation.Transactional}.
 *
 * Wraps an annotated method in a Helios transaction managed by
 * {@link HeliosTransactionManager}. The globally registered manager
 * (via {@link HeliosTransactionManager.setCurrent}) is used at call time.
 *
 * Supports:
 *   - \@Transactional()              — REQUIRED propagation, manager default timeout
 *   - \@Transactional({ timeout: N }) — N-second timeout (overrides manager default)
 *   - \@Transactional({ propagation: Propagation.REQUIRES_NEW }) — throws if nested
 */

import { HeliosTransactionManager, type TransactionalRunOptions } from './HeliosTransactionManager';

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
            const mgr = HeliosTransactionManager.getCurrent();
            if (!mgr) {
                // No manager registered — execute without transaction wrapping.
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
