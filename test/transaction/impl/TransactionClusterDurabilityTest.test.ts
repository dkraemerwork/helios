import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { afterEach, describe, expect, it } from 'bun:test';
import { TransactionOptions, TransactionType } from '@zenystx/helios-core/transaction/TransactionOptions';

const BASE_PORT = 17180;

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
        }
        await Bun.sleep(25);
    }
}

function makeConfig(name: string, port: number, peerPorts: number[]): HeliosConfig {
    const config = new HeliosConfig(name);
    config.getNetworkConfig().setPort(port).setClientProtocolPort(0).getJoin().getTcpIpConfig().setEnabled(true);
    for (const peerPort of peerPorts) {
        config.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${peerPort}`);
    }
    return config;
}

describe('TransactionClusterDurabilityTest', () => {
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

    it('commits prepared transaction from replicated backup state during failover recovery', async () => {
        const portA = BASE_PORT;
        const portB = BASE_PORT + 1;
        const nodeA = await Helios.newInstance(makeConfig('tx-durability-a', portA, []));
        const nodeB = await Helios.newInstance(makeConfig('tx-durability-b', portB, [portA]));
        instances.push(nodeA, nodeB);

        await waitUntil(() => nodeA.getCluster().getMembers().length === 2 && nodeB.getCluster().getMembers().length === 2);

        const coordinator = (nodeA as unknown as { _transactionCoordinator: any })._transactionCoordinator;
        const tx = coordinator.newTransaction(new TransactionOptions().setTransactionType(TransactionType.TWO_PHASE).setDurability(1), 'owner-a');

        await coordinator.beginTransaction(tx);
        const nodeEngine = nodeA.getNodeEngine();
        const keyData = nodeEngine.toData('key')!;
        const key2Data = nodeEngine.toData('key-2')!;
        (nodeA as any)._clientTransactions.set(tx.getTxnId(), {
            transaction: tx,
            mapProxies: new Map(),
            queueProxies: new Map(),
            listProxies: new Map(),
            setProxies: new Map(),
            multiMapProxies: new Map(),
        });
        const map = (nodeA as any)._getTransactionalMap(tx.getTxnId(), 'durable-map');
        map.put(keyData, nodeEngine.toData('value')!);
        map.put(key2Data, nodeEngine.toData('value-2')!);
        await tx.prepare();

        await waitUntil(() => {
            const backupLog = (nodeB as any)._transactionManagerService.getBackupLog(tx.getTxnId());
            return backupLog !== null && backupLog.state === 'PREPARED' && backupLog.records.length === 2;
        });

        await (nodeB as any)._transactionManagerService.recoverBackupLogsForCoordinator(nodeA.getLocalMemberId());

        const backupNodeEngine = nodeB.getNodeEngine();
        const backupStore1 = (nodeB as any)._mapService.getOrCreateRecordStore('durable-map', backupNodeEngine.getPartitionService().getPartitionId(keyData));
        const backupStore2 = (nodeB as any)._mapService.getOrCreateRecordStore('durable-map', backupNodeEngine.getPartitionService().getPartitionId(key2Data));
        expect(backupNodeEngine.toObject<string>(backupStore1.get(keyData))).toBe('value');
        expect(backupNodeEngine.toObject<string>(backupStore2.get(key2Data))).toBe('value-2');
        expect((nodeB as any)._transactionManagerService.getBackupLog(tx.getTxnId())).toBeNull();
    });
});
