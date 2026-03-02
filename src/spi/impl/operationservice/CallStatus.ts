/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.CallStatus}.
 *
 * The result of calling an operation's call() method.
 * Used by BlockingOperation implementations like ReadManyOperation.
 */
export enum CallStatus {
    /** Operation has completed and has a response ready. */
    RESPONSE = 'RESPONSE',
    /** Operation needs to wait (block) for more data. */
    WAIT = 'WAIT',
    /** Operation has been dispatched off-thread. */
    OFFLOADED = 'OFFLOADED',
    /** Operation has been converted to a void response. */
    VOID = 'VOID',
}
