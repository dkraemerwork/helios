/**
 * @zenystx/helios-nestjs/transaction — Transaction subpath barrel.
 *
 * Import transaction-related symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { HeliosTransactionModule, Transactional, Propagation } from '@zenystx/helios-nestjs/transaction';
 * ```
 */

export {
    HeliosTransactionModule,
    type HeliosTransactionModuleOptions,
    type HeliosTransactionModuleAsyncOptions,
    type HeliosTransactionModuleOptionsFactory,
} from './HeliosTransactionModule';
export {
    HeliosTransactionManager,
    type TransactionContextFactory,
    type TransactionCreateOptions,
    type TransactionalRunOptions,
} from './HeliosTransactionManager';
export { Transactional, Propagation, type TransactionalOptions } from './Transactional';
export { ManagedTransactionalTaskContext } from './ManagedTransactionalTaskContext';
export {
    NoTransactionException,
    TransactionSystemException,
    TransactionSuspensionNotSupportedException,
    CannotCreateTransactionException,
} from './TransactionExceptions';
