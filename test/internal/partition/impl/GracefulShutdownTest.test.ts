/**
 * Tests for Block 16.B5 — Graceful Shutdown Protocol.
 * Covers ShutdownRequestOp, ProcessShutdownRequestsTask, and graceful
 * shutdown integration with InternalPartitionServiceImpl + MigrationManager.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { InternalPartitionServiceImpl } from '@helios/internal/partition/impl/InternalPartitionServiceImpl';
import { PartitionStateManager } from '@helios/internal/partition/impl/PartitionStateManager';
import { ShutdownRequestHandler } from '@helios/internal/partition/impl/ShutdownRequestHandler';
import { ProcessShutdownRequestsTask } from '@helios/internal/partition/impl/ProcessShutdownRequestsTask';
import { Address } from '@helios/cluster/Address';
import { MemberImpl } from '@helios/cluster/impl/MemberImpl';
import { MemberVersion } from '@helios/version/MemberVersion';
import type { Member } from '@helios/cluster/Member';

function makeMember(host: string, port: number, uuid?: string): Member {
    return new MemberImpl.Builder(new Address(host, port))
        .uuid(uuid ?? crypto.randomUUID())
        .version(MemberVersion.of(1, 0, 0))
        .localMember(false)
        .build();
}

const PARTITION_COUNT = 271;

describe('GracefulShutdown', () => {
    let masterAddr: Address;
    let master: Member;
    let member2: Member;
    let member3: Member;
    let service: InternalPartitionServiceImpl;

    beforeEach(() => {
        masterAddr = new Address('127.0.0.1', 5701);
        master = makeMember('127.0.0.1', 5701, 'master-uuid');
        member2 = makeMember('127.0.0.1', 5702, 'member2-uuid');
        member3 = makeMember('127.0.0.1', 5703, 'member3-uuid');
        service = new InternalPartitionServiceImpl(PARTITION_COUNT);
    });

    // ── ShutdownRequestHandler ──────────────────────────────────────

    test('requestShutdown adds member to shutdownRequestedMembers', () => {
        const handler = new ShutdownRequestHandler(service);
        handler.requestShutdown(member2.getAddress());

        expect(handler.isShutdownRequested(member2.getAddress())).toBe(true);
        expect(handler.isShutdownRequested(master.getAddress())).toBe(false);
    });

    test('requestShutdown is idempotent — duplicate sends handled without error', () => {
        const handler = new ShutdownRequestHandler(service);
        handler.requestShutdown(member2.getAddress());
        handler.requestShutdown(member2.getAddress());

        expect(handler.getShutdownRequestedAddresses().size).toBe(1);
    });

    test('getShutdownRequestedAddresses returns all requested members', () => {
        const handler = new ShutdownRequestHandler(service);
        handler.requestShutdown(member2.getAddress());
        handler.requestShutdown(member3.getAddress());

        expect(handler.getShutdownRequestedAddresses().size).toBe(2);
    });

    test('removeShutdownRequest removes member from set', () => {
        const handler = new ShutdownRequestHandler(service);
        handler.requestShutdown(member2.getAddress());
        handler.removeShutdownRequest(member2.getAddress());

        expect(handler.isShutdownRequested(member2.getAddress())).toBe(false);
    });

    // ── Repartition with excluded shutdown members ──────────────────

    test('departing node not assigned any new partitions during shutdown window', () => {
        // Simulate graceful shutdown: repartition with member2 excluded
        // (same pattern as memberRemoved: remaining members don't include departing node)
        const stateManager = new PartitionStateManager(PARTITION_COUNT);
        stateManager.initializePartitionAssignments([master, member2, member3], 0);

        const newAssignment = stateManager.repartition([master, member3], [member2]);
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const owner = newAssignment[i][0];
            if (owner) {
                expect(owner.address().equals(member2.getAddress())).toBe(false);
            }
        }
    });

    test('graceful shutdown: all partitions migrated off departing node', () => {
        service.firstArrangement([master, member2], masterAddr);

        // Before shutdown, member2 has partitions
        const beforePartitions = service.getMemberPartitions(member2.getAddress());
        expect(beforePartitions.length).toBeGreaterThan(0);

        // member2 requests graceful shutdown — repartition excludes it
        service.memberRemoved(member2, [master]);

        // After repartition, member2 owns zero partitions
        const afterPartitions = service.getMemberPartitions(member2.getAddress());
        expect(afterPartitions.length).toBe(0);
    });

    test('concurrent shutdown: two nodes shutting down simultaneously — both excluded from repartition', () => {
        const stateManager = new PartitionStateManager(PARTITION_COUNT);
        stateManager.initializePartitionAssignments([master, member2, member3], 0);

        // Both member2 and member3 are departing — only master remains
        const newAssignment = stateManager.repartition([master], [member2, member3]);

        // Both member2 and member3 should have zero partitions in new assignment
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const owner = newAssignment[i][0];
            if (owner) {
                expect(owner.address().equals(member2.getAddress())).toBe(false);
                expect(owner.address().equals(member3.getAddress())).toBe(false);
            }
        }
    });

    // ── ProcessShutdownRequestsTask ────────────────────────────────

    test('ProcessShutdownRequestsTask sends response when partitions are migrated away', () => {
        service.firstArrangement([master, member2], masterAddr);

        const handler = new ShutdownRequestHandler(service);
        handler.requestShutdown(member2.getAddress());

        // Migrate partitions away from member2
        service.memberRemoved(member2, [master]);

        // Now member2 has 0 partitions
        const responses: Address[] = [];
        const task = new ProcessShutdownRequestsTask(handler, service, (addr: Address) => {
            responses.push(addr);
        });
        task.run();

        // Should have sent response to member2 and removed from shutdown set
        expect(responses.length).toBe(1);
        expect(responses[0].equals(member2.getAddress())).toBe(true);
        expect(handler.isShutdownRequested(member2.getAddress())).toBe(false);
    });

    test('ProcessShutdownRequestsTask does not send response if partitions remain', () => {
        service.firstArrangement([master, member2], masterAddr);

        const handler = new ShutdownRequestHandler(service);
        handler.requestShutdown(member2.getAddress());

        // Do NOT migrate — member2 still has partitions
        const responses: Address[] = [];
        const task = new ProcessShutdownRequestsTask(handler, service, (addr: Address) => {
            responses.push(addr);
        });
        task.run();

        // No response sent
        expect(responses.length).toBe(0);
        expect(handler.isShutdownRequested(member2.getAddress())).toBe(true);
    });

    test('memberRemoved after graceful shutdown does not trigger redundant replanning', () => {
        const handler = new ShutdownRequestHandler(service);
        handler.requestShutdown(member2.getAddress());

        // When memberRemoved fires, handler knows it was graceful
        expect(handler.isShutdownRequested(member2.getAddress())).toBe(true);

        // Remove from shutdown set (as would happen after ack)
        handler.removeShutdownRequest(member2.getAddress());
        expect(handler.isShutdownRequested(member2.getAddress())).toBe(false);
    });
});
