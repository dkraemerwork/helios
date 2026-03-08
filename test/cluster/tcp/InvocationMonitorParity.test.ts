import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

const BASE_PORT = 17040;
let portCounter = 0;

function nextPort(): number {
    return BASE_PORT + portCounter++;
}

async function waitUntil(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 5000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil: timed out after ${timeoutMs} ms`);
        }
        await Bun.sleep(20);
    }
}

async function waitForClusterSize(instance: HeliosInstanceImpl, count: number): Promise<void> {
    await waitUntil(() => instance.getCluster().getMembers().length === count, 10_000);
}

async function startNode(
    name: string,
    port: number,
    peerPorts: number[] = [],
): Promise<HeliosInstanceImpl> {
    const cfg = new HeliosConfig(name);
    cfg.getNetworkConfig()
        .setPort(port)
        .getJoin()
        .getTcpIpConfig()
        .setEnabled(true);
    for (const peerPort of peerPorts) {
        cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${peerPort}`);
    }
    return Helios.newInstance(cfg);
}

function findKeyOwnedBy(instance: HeliosInstanceImpl, ownerId: string): string {
    for (let i = 0; i < 5000; i++) {
        const key = `invocation-monitor-${i}`;
        const partitionId = instance.getPartitionIdForName(key);
        if (instance.getPartitionOwnerId(partitionId) === ownerId) {
            return key;
        }
    }
    throw new Error(`Unable to find key owned by ${ownerId}`);
}

describe('Invocation monitor parity', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(async () => {
        for (const instance of instances) {
            if (instance.isRunning()) {
                instance.shutdown();
            }
        }
        instances.length = 0;
        await Bun.sleep(50);
    });

    test('fails a remote invocation promptly when the target member leaves', async () => {
        const ownerPort = nextPort();
        const callerPort = nextPort();
        const owner = await startNode('invocation-owner', ownerPort);
        const caller = await startNode('invocation-caller', callerPort, [ownerPort]);
        instances.push(owner, caller);

        await waitForClusterSize(owner, 2);
        await waitForClusterSize(caller, 2);

        const key = findKeyOwnedBy(caller, owner.getName());
        await owner.getMap<string, string>('invocation-monitor-map').put(key, 'value');

        const originalHandleRemoteOperation = (owner as any)._handleRemoteOperation.bind(owner);
        (owner as any)._handleRemoteOperation = (message: unknown) => {
            void (async () => {
                await Bun.sleep(250);
                if (owner.isRunning()) {
                    originalHandleRemoteOperation(message);
                }
            })();
        };

        const invocationPromise = caller.getMap<string, string>('invocation-monitor-map').get(key);
        await waitUntil(() => (caller as any)._invocationMonitor.activeCount() === 1, 2000);

        const startedAt = Date.now();
        owner.shutdown();

        await expect(invocationPromise).rejects.toThrow(`Target member ${owner.getName()} left before invocation completed`);
        expect(Date.now() - startedAt).toBeLessThan(3000);
        await waitUntil(() => (caller as any)._invocationMonitor.activeCount() === 0, 2000);
    });
});
