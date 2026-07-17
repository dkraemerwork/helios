/**
 * Operation-level split-brain protection quorum enforcement.
 * Closes PARTIAL "Operation-level quorum enforcement".
 */
import { describe, expect, test } from 'bun:test';
import {
    SplitBrainProtectionConfig,
    SplitBrainProtectionOn,
} from '@zenystx/helios-core/config/SplitBrainProtectionConfig';
import { SplitBrainProtectionException } from '@zenystx/helios-core/core/exception/SplitBrainProtectionException';
import { SplitBrainProtectionServiceImpl } from '@zenystx/helios-core/splitbrainprotection/impl/SplitBrainProtectionServiceImpl';
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';

describe('SplitBrainProtection operation-level enforcement', () => {
    test('ensureQuorum throws when member count below minimum', () => {
        const cfg = new SplitBrainProtectionConfig('q1');
        cfg.setEnabled(true);
        cfg.setMinimumClusterSize(3);
        cfg.setProtectOn(SplitBrainProtectionOn.READ_WRITE);

        const members = new Set<string>(['a']);
        const service = new SplitBrainProtectionServiceImpl(
            new Map([['q1', cfg]]),
            {
                getSize: () => members.size,
                getMemberIds: () => members,
            },
        );

        // Only 1 member → quorum not met
        expect(() => service.ensureQuorum(SplitBrainProtectionOn.WRITE, 'q1')).toThrow(
            SplitBrainProtectionException,
        );

        members.add('b');
        members.add('c');
        service.onMembershipChanged();
        // 3 members → OK
        expect(() => service.ensureQuorum(SplitBrainProtectionOn.WRITE, 'q1')).not.toThrow();
    });

    test('READ-only protectOn does not block WRITE', () => {
        const cfg = new SplitBrainProtectionConfig('read-only');
        cfg.setEnabled(true);
        cfg.setMinimumClusterSize(5);
        cfg.setProtectOn(SplitBrainProtectionOn.READ);

        const service = new SplitBrainProtectionServiceImpl(
            new Map([['read-only', cfg]]),
            {
                getSize: () => 1,
                getMemberIds: () => new Set(['solo']),
            },
        );

        expect(() => service.ensureQuorum(SplitBrainProtectionOn.WRITE, 'read-only')).not.toThrow();
        expect(() => service.ensureQuorum(SplitBrainProtectionOn.READ, 'read-only')).toThrow(
            SplitBrainProtectionException,
        );
    });

    test('MapProxy put/get enforce quorum when protection is wired', async () => {
        const config = new HeliosConfig('sb-map-test');
        config.getNetworkConfig().setPort(0).setClientProtocolPort(0);

        const protection = new SplitBrainProtectionConfig('map-quorum');
        protection.setEnabled(true);
        protection.setMinimumClusterSize(3);
        protection.setProtectOn(SplitBrainProtectionOn.READ_WRITE);
        config.addSplitBrainProtectionConfig(protection);

        const mapCfg = new MapConfig('protected');
        mapCfg.setSplitBrainProtectionName('map-quorum');
        config.addMapConfig(mapCfg);

        const instance = await Helios.newInstance(config);
        try {
            const map = instance.getMap<string, string>('protected');
            // Single member → size 1 < 3
            await expect(map.put('k', 'v')).rejects.toBeInstanceOf(SplitBrainProtectionException);
        } finally {
            instance.shutdown();
        }
    });
});
