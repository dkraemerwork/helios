/**
 * Multi-node Raft consensus over real TcpClusterTransport (no Helios join timing).
 * Proves RaftTransportAdapter + RaftMessageRouter + AtomicLong state machine path.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { TcpClusterTransport } from '@zenystx/helios-core/cluster/tcp/TcpClusterTransport';
import { CPSubsystemConfig } from '@zenystx/helios-core/config/CPSubsystemConfig';
import { CpSubsystemService } from '@zenystx/helios-core/cp/impl/CpSubsystemService';
import { NotLeaderException } from '@zenystx/helios-core/cp/raft/errors';

const BASE = 19450;
let next = BASE;

async function waitUntil(pred: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!(await pred())) {
        if (Date.now() >= deadline) throw new Error('waitUntil timeout');
        await Bun.sleep(25);
    }
}

describe('CpRaftTransportConsensus', () => {
    const transports: TcpClusterTransport[] = [];
    const services: CpSubsystemService[] = [];

    afterEach(() => {
        for (const s of services) s.shutdown();
        services.length = 0;
        for (const t of transports) t.shutdown();
        transports.length = 0;
    });

    test('3-node Raft group commits AtomicLong over TCP', async () => {
        const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
        const ports = [next++, next++, next++];

        for (let i = 0; i < 3; i++) {
            const t = new TcpClusterTransport(ids[i]!);
            t.start(ports[i]!, '127.0.0.1');
            transports.push(t);
        }

        // Fully mesh the transports
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (i === j) continue;
                await transports[i]!.connectToPeer('127.0.0.1', ports[j]!);
            }
        }

        // Wire Raft message delivery
        const cpMembers = ids.map((uuid, i) => ({
            uuid,
            address: { host: '127.0.0.1', port: ports[i]! },
        }));
        const cpConfig = new CPSubsystemConfig().setCpMemberCount(3).setGroupSize(3);

        for (let i = 0; i < 3; i++) {
            const svc = new CpSubsystemService(ids[i]!, cpConfig, transports[i], cpMembers);
            expect(svc.isMultiNodeEnabled()).toBe(true);
            services.push(svc);
            transports[i]!.onMessage = (msg) => {
                void svc.handleRaftMessage(msg);
            };
        }

        await Promise.all(services.map((s) => s.initializeMultiNode()));

        // Elect / find a leader for the default group and commit
        let leader: CpSubsystemService | null = null;
        let lastError: unknown;
        await waitUntil(async () => {
            for (const svc of services) {
                try {
                    const result = await svc.executeRaftCommand('counter', {
                        type: 'ATOMIC_LONG_ADD',
                        groupId: 'default',
                        key: 'atomiclong:counter',
                        payload: { delta: '1', returnNew: true },
                    });
                    leader = svc;
                    expect(BigInt(result as string)).toBeGreaterThanOrEqual(1n);
                    return true;
                } catch (e) {
                    lastError = e;
                    if (!(e instanceof NotLeaderException)) {
                        // Still electing / group creating
                    }
                }
            }
            return false;
        }, 20_000);

        expect(leader).not.toBeNull();

        // Further mutation on leader
        const after = await leader!.executeRaftCommand('counter', {
            type: 'ATOMIC_LONG_ADD',
            groupId: 'default',
            key: 'atomiclong:counter',
            payload: { delta: '9', returnNew: true },
        });
        expect(BigInt(after as string)).toBeGreaterThanOrEqual(10n);

        // Read from leader
        const got = await leader!.executeRaftCommand('counter', {
            type: 'ATOMIC_LONG_GET',
            groupId: 'default',
            key: 'atomiclong:counter',
            payload: null,
        });
        expect(BigInt(got as string)).toBe(BigInt(after as string));
    }, 40_000);
});
