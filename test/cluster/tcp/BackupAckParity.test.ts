import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapService } from '@zenystx/helios-core/map/impl/MapService';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

const BASE_PORT = 17140;
const MAP_NAME = 'backup-ack-parity-map';
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

function findKeyWithDistinctBackup(
    instance: HeliosInstanceImpl,
    callerId: string,
): { key: string; ownerId: string; backupId: string } {
    const coordinator = (instance as any)._clusterCoordinator;
    for (let i = 0; i < 10_000; i++) {
        const key = `backup-ack-${i}`;
        const partitionId = instance.getPartitionIdForName(key);
        const ownerId = instance.getPartitionOwnerId(partitionId);
        const backupIds = coordinator.getBackupIds(partitionId, 1) as string[];
        if (
            ownerId !== null
            && ownerId !== callerId
            && backupIds[0] !== undefined
            && backupIds[0] !== callerId
            && backupIds[0] !== ownerId
        ) {
            return { key, ownerId, backupId: backupIds[0] };
        }
    }
    throw new Error(`Unable to find key with remote owner and non-${callerId} backup`);
}

function readBackupValue(instance: HeliosInstanceImpl, mapName: string, partitionId: number, key: string): unknown {
    const nodeEngine = (instance as any)._nodeEngine;
    const mapService = nodeEngine.getService(MapService.SERVICE_NAME) as {
        getOrCreateRecordStore: (name: string, pid: number) => { get: (data: unknown) => unknown };
    };
    const dataKey = (instance as any)._ss.toData(key);
    const dataValue = mapService.getOrCreateRecordStore(mapName, partitionId).get(dataKey);
    return dataValue === null || dataValue === undefined ? dataValue : (instance as any)._ss.toObject(dataValue);
}

function requireInstanceByName(instances: HeliosInstanceImpl[], memberId: string): HeliosInstanceImpl {
    const instance = instances.find((candidate) => candidate.getName() === memberId);
    if (instance === undefined) {
        throw new Error(`No instance found for member ${memberId}`);
    }
    return instance;
}

describe('Backup ack parity', () => {
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

    test('waits for the real backup ack before completing a remote put', async () => {
        const ownerPort = nextPort();
        const backupPort = nextPort();
        const sparePort = nextPort();
        const callerPort = nextPort();
        const owner = await startNode('backup-owner', ownerPort);
        const backup = await startNode('backup-replica', backupPort, [ownerPort]);
        const spare = await startNode('backup-spare', sparePort, [ownerPort, backupPort]);
        const caller = await startNode('backup-caller', callerPort, [ownerPort, backupPort, sparePort]);
        instances.push(owner, backup, spare, caller);

        await waitForClusterSize(owner, 4);
        await waitForClusterSize(backup, 4);
        await waitForClusterSize(spare, 4);
        await waitForClusterSize(caller, 4);

        const selected = findKeyWithDistinctBackup(caller, caller.getName());
        const key = selected.key;
        const partitionId = caller.getPartitionIdForName(key);
        const backupTarget = requireInstanceByName([owner, backup, spare], selected.backupId);

        const originalHandleBackup = (backupTarget as any)._handleBackup.bind(backupTarget);
        (backupTarget as any)._handleBackup = (message: unknown) => {
            void (async () => {
                await Bun.sleep(300);
                originalHandleBackup(message);
            })();
        };

        const startedAt = Date.now();
        await caller.getMap<string, string>(MAP_NAME).put(key, 'value-1');

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
        await waitUntil(() => readBackupValue(backupTarget, MAP_NAME, partitionId, key) === 'value-1', 3000);
        expect((caller as any)._invocationMonitor.getStats().lateBackupAcksIgnored).toBe(0);
    });

    test('fails with a bounded backup ack timeout when the backup never acknowledges', async () => {
        const ownerPort = nextPort();
        const backupPort = nextPort();
        const sparePort = nextPort();
        const callerPort = nextPort();
        const owner = await startNode('timeout-owner', ownerPort);
        const backup = await startNode('timeout-backup', backupPort, [ownerPort]);
        const spare = await startNode('timeout-spare', sparePort, [ownerPort, backupPort]);
        const caller = await startNode('timeout-caller', callerPort, [ownerPort, backupPort, sparePort]);
        instances.push(owner, backup, spare, caller);

        await waitForClusterSize(owner, 4);
        await waitForClusterSize(backup, 4);
        await waitForClusterSize(spare, 4);
        await waitForClusterSize(caller, 4);

        const selected = findKeyWithDistinctBackup(caller, caller.getName());
        const key = selected.key;
        const backupTarget = requireInstanceByName([owner, backup, spare], selected.backupId);
        (backupTarget as any)._handleBackup = () => {};

        const startedAt = Date.now();
        await expect(caller.getMap<string, string>(MAP_NAME).put(key, 'value-timeout')).rejects.toThrow('Backup ack timed out');
        expect(Date.now() - startedAt).toBeLessThan(4000);
        await waitUntil(() => (caller as any)._invocationMonitor.activeCount() === 0, 2000);
        expect((caller as any)._invocationMonitor.getStats().backupAckTimeoutFailures).toBe(1);
    });

    test('fails promptly when the backup member leaves before the ack arrives', async () => {
        const ownerPort = nextPort();
        const backupPort = nextPort();
        const sparePort = nextPort();
        const callerPort = nextPort();
        const owner = await startNode('leave-owner', ownerPort);
        const backup = await startNode('leave-backup', backupPort, [ownerPort]);
        const spare = await startNode('leave-spare', sparePort, [ownerPort, backupPort]);
        const caller = await startNode('leave-caller', callerPort, [ownerPort, backupPort, sparePort]);
        instances.push(owner, backup, spare, caller);

        await waitForClusterSize(owner, 4);
        await waitForClusterSize(backup, 4);
        await waitForClusterSize(spare, 4);
        await waitForClusterSize(caller, 4);

        const selected = findKeyWithDistinctBackup(caller, caller.getName());
        const key = selected.key;
        const backupTarget = requireInstanceByName([owner, backup, spare], selected.backupId);
        const originalHandleBackup = (backupTarget as any)._handleBackup.bind(backupTarget);
        (backupTarget as any)._handleBackup = (message: unknown) => {
            void (async () => {
                await Bun.sleep(400);
                if (backupTarget.isRunning()) {
                    originalHandleBackup(message);
                }
            })();
        };

        const invocation = caller.getMap<string, string>(MAP_NAME).put(key, 'value-leave');
        await waitUntil(() => (caller as any)._invocationMonitor.activeCount() === 1, 2000);

        const startedAt = Date.now();
        backupTarget.shutdown();

        await expect(invocation).rejects.toThrow(`Backup member ${backupTarget.getName()} left before acknowledgement completed`);
        expect(Date.now() - startedAt).toBeLessThan(3000);
        await waitUntil(() => (caller as any)._invocationMonitor.activeCount() === 0, 2000);
    });
});
