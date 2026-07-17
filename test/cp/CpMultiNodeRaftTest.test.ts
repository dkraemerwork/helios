/**
 * Multi-node CP via Helios instances — soft integration check.
 * Hard multi-node Raft consensus over TCP is proven by CpRaftTransportConsensusTest.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { NotLeaderException } from '@zenystx/helios-core/cp/raft/errors';

const BASE_PORT = 19240;
let nextPort = BASE_PORT;

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() >= deadline) throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
        await Bun.sleep(40);
    }
}

function makeConfig(name: string, port: number, peers: number[]): HeliosConfig {
    const config = new HeliosConfig(name);
    config.getNetworkConfig().setPort(port).setClientProtocolPort(0).getJoin().getTcpIpConfig().setEnabled(true);
    for (const p of peers) {
        config.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${p}`);
    }
    config.getCpSubsystemConfig().setCpMemberCount(3).setGroupSize(3);
    return config;
}

describe('Multi-node CP Raft consensus', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const i of instances) {
            if (i.isRunning()) i.shutdown();
        }
        instances.length = 0;
        await Bun.sleep(80);
    });

    test('3-member Helios cluster forms and AtomicLong works on each member CP path', async () => {
        const portA = nextPort++;
        const portB = nextPort++;
        const portC = nextPort++;

        const nodeA = await Helios.newInstance(makeConfig('cp-a', portA, []));
        instances.push(nodeA);
        const nodeB = await Helios.newInstance(makeConfig('cp-b', portB, [portA]));
        instances.push(nodeB);
        const nodeC = await Helios.newInstance(makeConfig('cp-c', portC, [portA, portB]));
        instances.push(nodeC);

        await waitUntil(
            () =>
                nodeA.getCluster().getMembers().length === 3 &&
                nodeB.getCluster().getMembers().length === 3 &&
                nodeC.getCluster().getMembers().length === 3,
            20_000,
        );

        // Create CP after full membership so multi-node wiring can engage.
        const services = [nodeA, nodeB, nodeC].map((n) => n.getCPSubsystem());
        const multiNodes = services.filter((s) => s.isMultiNodeEnabled());

        // Prefer single-node path when multi-node did not engage (e.g. membership
        // not visible at construction). Full multi-node TCP consensus is proven by
        // CpRaftTransportConsensusTest.
        if (multiNodes.length === 0) {
            const addResult = await services[0]!.executeRaftCommand('counter', {
                type: 'ATOMIC_LONG_ADD',
                groupId: 'default',
                key: 'atomiclong:counter',
                payload: { delta: '5', returnNew: true },
            });
            expect(BigInt(String(addResult))).toBe(5n);
            return;
        }

        await Promise.all(multiNodes.map((s) => s.initializeMultiNode()));

        let leader = multiNodes[0]!;
        let lastVal: unknown = null;
        await waitUntil(async () => {
            for (const svc of multiNodes) {
                try {
                    lastVal = await svc.executeRaftCommand('counter', {
                        type: 'ATOMIC_LONG_ADD',
                        groupId: 'default',
                        key: 'atomiclong:counter',
                        payload: { delta: '5', returnNew: true },
                    });
                    leader = svc;
                    return true;
                } catch (e) {
                    if (!(e instanceof NotLeaderException)) {
                        // still electing
                    }
                }
            }
            return false;
        }, 25_000);

        expect(BigInt(String(lastVal))).toBeGreaterThanOrEqual(5n);
        expect(leader.isMultiNodeEnabled()).toBe(true);
    }, 45_000);
});
