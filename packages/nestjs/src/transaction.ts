/**
 * @zenystx/helios-nestjs/transaction — Transaction subpath barrel.
 *
 * Import transaction-related symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { HeliosTransactionModule, Transactional, Propagation } from '@zenystx/helios-nestjs/transaction';
 * ```
 */

export {
    HeliosTransactionManager,
    type TransactionContextFactory,
    type TransactionCreateOptions,
    type TransactionalRunOptions
} from './HeliosTransactionManager';
export {
    HeliosTransactionModule, type HeliosTransactionModuleAsyncOptions, type HeliosTransactionModuleOptions, type HeliosTransactionModuleOptionsFactory
} from './HeliosTransactionModule';
export { ManagedTransactionalTaskContext } from './ManagedTransactionalTaskContext';
export { Propagation, Transactional, type TransactionalOptions } from './Transactional';
export {
    CannotCreateTransactionException, NoTransactionException, TransactionSuspensionNotSupportedException, TransactionSystemException
} from './TransactionExceptions';
