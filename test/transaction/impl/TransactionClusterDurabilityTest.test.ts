import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import type { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { TransactionOptions, TransactionType } from '@zenystx/helios-core/transaction/TransactionOptions';

const BASE_PORT = 17180;

setDefaultTimeout(15_000);

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
    config.getQueueConfig('durable-queue').setBackupCount(2);
    config.getQueueConfig('durable-list').setBackupCount(2);
    config.getQueueConfig('durable-set').setBackupCount(2);
    config.getQueueConfig('durable-multimap').setBackupCount(2);
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
        const portC = BASE_PORT + 2;
        const nodeA = await Helios.newInstance(makeConfig('tx-durability-a', portA, []));
        const nodeB = await Helios.newInstance(makeConfig('tx-durability-b', portB, [portA]));
        const nodeC = await Helios.newInstance(makeConfig('tx-durability-c', portC, [portA, portB]));
        instances.push(nodeA, nodeB, nodeC);

        await waitUntil(() => nodeA.getCluster().getMembers().length === 3 && nodeB.getCluster().getMembers().length === 3 && nodeC.getCluster().getMembers().length === 3);

        const coordinator = (nodeA as unknown as { _transactionCoordinator: any })._transactionCoordinator;
        const tx = coordinator.newTransaction(new TransactionOptions().setTransactionType(TransactionType.TWO_PHASE).setDurability(2), 'owner-a');

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

        expect(await (nodeB as any)._transactionManagerService.recoverBackupLogsForCoordinator(nodeA.getLocalMemberId())).toBe(1);

        const backupNodeEngine = nodeB.getNodeEngine();
        const backupStore1 = (nodeB as any)._mapService.getOrCreateRecordStore('durable-map', backupNodeEngine.getPartitionService().getPartitionId(keyData));
        const backupStore2 = (nodeB as any)._mapService.getOrCreateRecordStore('durable-map', backupNodeEngine.getPartitionService().getPartitionId(key2Data));
        expect(backupNodeEngine.toObject<string>(backupStore1.get(keyData))).toBe('value');
        expect(backupNodeEngine.toObject<string>(backupStore2.get(key2Data))).toBe('value-2');
        expect((nodeB as any)._transactionManagerService.getBackupLog(tx.getTxnId())).toBeNull();
        expect((nodeC as any)._transactionManagerService.getBackupLog(tx.getTxnId())?.state).toBe('PREPARED');
    });

    it('recovery replay is exactly-once for duplicate-sensitive structures', async () => {
        const portA = BASE_PORT + 10;
        const portB = BASE_PORT + 11;
        const portC = BASE_PORT + 12;
        const nodeA = await Helios.newInstance(makeConfig('tx-durability-ops-a', portA, []));
        const nodeB = await Helios.newInstance(makeConfig('tx-durability-ops-b', portB, [portA]));
        const nodeC = await Helios.newInstance(makeConfig('tx-durability-ops-c', portC, [portA, portB]));
        instances.push(nodeA, nodeB, nodeC);

        await waitUntil(() => nodeA.getCluster().getMembers().length === 3 && nodeB.getCluster().getMembers().length === 3 && nodeC.getCluster().getMembers().length === 3);

        await nodeA.getList<string>('durable-list').add('seed');
        await nodeA.getMultiMap<string, string>('durable-multimap').put('k', 'seed');

        const coordinator = (nodeA as unknown as { _transactionCoordinator: any })._transactionCoordinator;
        const tx = coordinator.newTransaction(new TransactionOptions().setTransactionType(TransactionType.TWO_PHASE).setDurability(2), 'owner-b');
        await coordinator.beginTransaction(tx);

        const nodeEngine = nodeA.getNodeEngine();
        (nodeA as any)._clientTransactions.set(tx.getTxnId(), {
            transaction: tx,
            mapProxies: new Map(),
            queueProxies: new Map(),
            listProxies: new Map(),
            setProxies: new Map(),
            multiMapProxies: new Map(),
        });

        const queue = (nodeA as any)._getTransactionalQueue(tx.getTxnId(), 'durable-queue');
        const list = (nodeA as any)._getTransactionalList(tx.getTxnId(), 'durable-list');
        const set = (nodeA as any)._getTransactionalSet(tx.getTxnId(), 'durable-set');
        const multiMap = (nodeA as any)._getTransactionalMultiMap(tx.getTxnId(), 'durable-multimap');
        queue.offer(nodeEngine.toData('tx-item')!);
        await queue.poll();
        list.add(nodeEngine.toData('tx-list')!);
        set.add(nodeEngine.toData('tx-set')!);
        multiMap.put(nodeEngine.toData('k')!, nodeEngine.toData('tx-mm')!);

        await tx.prepare();

        await (nodeB as any)._transactionManagerService.recoverBackupLogsForCoordinator(nodeA.getLocalMemberId());
        await (nodeB as any)._transactionManagerService.recoverBackupLogsForCoordinator(nodeA.getLocalMemberId());

        expect(await nodeB.getQueue<string>('durable-queue').toArray()).toEqual(['tx-item']);
        expect(await nodeB.getList<string>('durable-list').toArray()).toEqual(['seed', 'tx-list']);
        expect(new Set(await nodeB.getSet<string>('durable-set').toArray())).toEqual(new Set(['tx-set']));
        expect([...await nodeB.getMultiMap<string, string>('durable-multimap').get('k')]).toEqual(['seed', 'tx-mm']);

        expect(await nodeC.getQueue<string>('durable-queue').toArray()).toEqual(['tx-item']);
        expect(await nodeC.getList<string>('durable-list').toArray()).toEqual(['seed', 'tx-list']);
        expect(new Set(await nodeC.getSet<string>('durable-set').toArray())).toEqual(new Set(['tx-set']));
        expect([...await nodeC.getMultiMap<string, string>('durable-multimap').get('k')]).toEqual(['seed', 'tx-mm']);
    });
});
