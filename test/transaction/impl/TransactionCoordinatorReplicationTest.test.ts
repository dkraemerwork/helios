/**
 * Coordinator ownership / partition-keyed recovery selection.
 * Complements TransactionClusterDurabilityTest multi-node backup proof.
 */
import { describe, expect, test } from 'bun:test';
import { NodeEngineImpl } from '@zenystx/helios-core/spi/impl/NodeEngineImpl';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { TransactionCoordinator } from '@zenystx/helios-core/transaction/impl/TransactionCoordinator';
import { TransactionManagerServiceImpl } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl';
import { TransactionOptions, TransactionType } from '@zenystx/helios-core/transaction/TransactionOptions';

/**
 * Partition coordinator ownership: hash txnId to a stable owner among backups.
 * Mirrors the recovery-winner election used by multi-node durability.
 */
function electCoordinatorOwner(txnId: string, memberIds: readonly string[]): string {
    if (memberIds.length === 0) throw new Error('no members');
    let h = 0;
    for (let i = 0; i < txnId.length; i++) {
        h = (Math.imul(31, h) + txnId.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % memberIds.length;
    return memberIds[idx]!;
}

describe('Transaction coordinator partition ownership', () => {
    test('owner election is deterministic for a txnId', () => {
        const members = ['m1', 'm2', 'm3'];
        const a = electCoordinatorOwner('txn-abc', members);
        const b = electCoordinatorOwner('txn-abc', members);
        expect(a).toBe(b);
        expect(members).toContain(a);
    });

    test('different txnIds can map to different owners', () => {
        const members = ['m1', 'm2', 'm3', 'm4', 'm5'];
        const owners = new Set(
            Array.from({ length: 50 }, (_, i) => electCoordinatorOwner(`txn-${i}`, members)),
        );
        expect(owners.size).toBeGreaterThan(1);
    });

    test('coordinator begin/commit lifecycle with durability backup targets', async () => {
        const ss = new SerializationServiceImpl(new SerializationConfig());
        const nodeEngine = new NodeEngineImpl(ss);
        const applied: string[] = [];
        const transport = {
            localMemberId: 'coord-1',
            getBackupMemberIds: (durability: number) =>
                ['backup-1', 'backup-2'].slice(0, durability),
            validateBackupMembers: async (targets: readonly string[]) => [...targets],
            replicate: async (message: { type: string; txnId: string }, targets: readonly string[]) => {
                applied.push(`${message.type}:${message.txnId}:${targets.join(',')}`);
                return [...targets];
            },
        };
        const txManager = new TransactionManagerServiceImpl(nodeEngine, transport as never, null);
        const coordinator = new TransactionCoordinator(nodeEngine, txManager);

        const options = new TransactionOptions()
            .setTransactionType(TransactionType.TWO_PHASE)
            .setDurability(2)
            .setTimeout(30_000);
        const tx = coordinator.newTransaction(options, 'owner-uuid');
        await coordinator.beginTransaction(tx);
        expect(coordinator.getTransactionState(tx.getTxnId())).not.toBeNull();
        expect(coordinator.getActiveTransactions().size).toBe(1);

        // prepare + commit path
        await tx.prepare();
        await coordinator.commitTransaction(tx.getTxnId());
        expect(coordinator.getActiveTransactions().size).toBe(0);
        // Backup replication should have been attempted for durable tx
        expect(applied.some((s) => s.includes(tx.getTxnId()))).toBe(true);
    });
});
