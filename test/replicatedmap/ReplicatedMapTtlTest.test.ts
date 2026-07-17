/**
 * ReplicatedMap TTL enforcement — closes PARTIAL "TTL on Put".
 * Drives DistributedReplicatedMapService put/get/contains/size with real expiry.
 */
import { describe, expect, test } from 'bun:test';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { DistributedReplicatedMapService } from '@zenystx/helios-core/replicatedmap/impl/DistributedReplicatedMapService';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { ReplicatedRecord } from '@zenystx/helios-core/replicatedmap/impl/record/ReplicatedRecord';

function makeService(): {
    service: DistributedReplicatedMapService;
    toData: (v: unknown) => import('@zenystx/helios-core/internal/serialization/Data').Data;
} {
    const ss = new SerializationServiceImpl(new SerializationConfig());
    const config = new HeliosConfig('rm-ttl-test');
    const service = new DistributedReplicatedMapService('rm-ttl-node', config, null, null);
    return {
        service,
        toData: (v) => {
            const d = ss.toData(v);
            if (d === null) throw new Error('null data');
            return d;
        },
    };
}

describe('ReplicatedMap TTL enforcement', () => {
    test('ReplicatedRecord.isExpired respects ttlMillis from update time', () => {
        const rec = new ReplicatedRecord('k', 'v', 50);
        expect(rec.isExpired(Date.now() - 1)).toBe(false);
        // Force update time into the past
        rec.setUpdateTime(Date.now() - 100);
        expect(rec.isExpired(Date.now())).toBe(true);
        const forever = new ReplicatedRecord('k', 'v', 0);
        expect(forever.isExpired(Date.now() + 1_000_000)).toBe(false);
    });

    test('put with TTL expires on subsequent get after sleep', async () => {
        const { service, toData } = makeService();
        const name = 'ttl-map';
        const key = toData('alpha');
        const value = toData('bravo');

        service.put(name, key, value, 40);
        expect(service.get(name, key)).not.toBeNull();
        expect(service.containsKey(name, key)).toBe(true);
        expect(service.size(name)).toBe(1);

        await Bun.sleep(60);

        expect(service.get(name, key)).toBeNull();
        expect(service.containsKey(name, key)).toBe(false);
        expect(service.size(name)).toBe(0);
        expect(service.keySet(name)).toHaveLength(0);
    });

    test('put with ttlMillis=0 never expires', async () => {
        const { service, toData } = makeService();
        const name = 'no-ttl';
        service.put(name, toData('k'), toData('v'), 0);
        await Bun.sleep(30);
        expect(service.get(name, toData('k'))).not.toBeNull();
        expect(service.size(name)).toBe(1);
    });

    test('expired entry is removed from entrySet and values', async () => {
        const { service, toData } = makeService();
        const name = 'ttl-set';
        service.put(name, toData(1), toData('one'), 30);
        service.put(name, toData(2), toData('two'), 0);
        await Bun.sleep(50);
        const entries = service.entrySet(name);
        expect(entries).toHaveLength(1);
        expect(service.values(name)).toHaveLength(1);
    });
});
