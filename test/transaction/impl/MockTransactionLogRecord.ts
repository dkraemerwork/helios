/**
 * Port of {@code com.hazelcast.transaction.impl.MockTransactionLogRecord}.
 *
 * Test helper that can be configured to fail prepare, commit, or rollback.
 */
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord';
import type { TransactionLogRecord } from '@zenystx/helios-core/transaction/impl/TransactionLogRecord';
import { TransactionException } from '@zenystx/helios-core/transaction/TransactionException';

class MockOperation extends Operation {
    private readonly _fail: boolean;

    constructor(fail: boolean) {
        super();
        this.serviceName = 'dummy';
        this.partitionId = 0;
        this._fail = fail;
    }

    async run(): Promise<void> {
        if (this._fail) {
            throw new TransactionException();
        }
    }
}

export class MockTransactionLogRecord implements TransactionLogRecord {
    private readonly _recordId = crypto.randomUUID();
    private _failPrepare = false;
    private _failCommit = false;
    private _failRollback = false;

    private _prepareCalled = false;
    private _commitCalled = false;
    private _rollbackCalled = false;

    failPrepare(): this {
        this._failPrepare = true;
        return this;
    }

    failCommit(): this {
        this._failCommit = true;
        return this;
    }

    failRollback(): this {
        this._failRollback = true;
        return this;
    }

    getKey(): null {
        return null;
    }

    getRecordId(): string {
        return this._recordId;
    }

    newPrepareOperation(): Operation {
        this._prepareCalled = true;
        return new MockOperation(this._failPrepare);
    }

    newCommitOperation(): Operation {
        this._commitCalled = true;
        return new MockOperation(this._failCommit);
    }

    newRollbackOperation(): Operation {
        this._rollbackCalled = true;
        return new MockOperation(this._failRollback);
    }

    toBackupRecord(): TransactionBackupRecord {
        return {
            recordId: this._recordId,
            kind: 'queue',
            queueName: 'mock',
            opType: 'poll',
            valueData: null,
        };
    }

    onCommitSuccess(): void {}
    onCommitFailure(): void {}

    assertCommitCalled(): this {
        if (!this._commitCalled) throw new Error('commit should have been called');
        return this;
    }

    assertPrepareCalled(): this {
        if (!this._prepareCalled) throw new Error('prepare should have been called');
        return this;
    }

    assertPrepareNotCalled(): this {
        if (this._prepareCalled) throw new Error('prepare should not have been called');
        return this;
    }

    assertCommitNotCalled(): this {
        if (this._commitCalled) throw new Error('commit should not have been called');
        return this;
    }

    assertRollbackNotCalled(): this {
        if (this._rollbackCalled) throw new Error('rollback should not have been called');
        return this;
    }

    assertRollbackCalled(): this {
        if (!this._rollbackCalled) throw new Error('rollback should have been called');
        return this;
    }
}
