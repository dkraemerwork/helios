/**
 * Tests for PersistenceConfig.
 */
import { describe, expect, test } from 'bun:test';
import { PersistenceConfig } from '@zenystx/helios-core/config/PersistenceConfig';

describe('PersistenceConfig', () => {
    test('defaults', () => {
        const config = new PersistenceConfig();
        expect(config.isEnabled()).toBe(false);
        expect(config.getBaseDir()).toBe(PersistenceConfig.DEFAULT_BASE_DIR);
        expect(config.getBackupDir()).toBeNull();
        expect(config.getParallelism()).toBe(PersistenceConfig.DEFAULT_PARALLELISM);
        expect(config.getValidationTimeoutSeconds()).toBe(PersistenceConfig.DEFAULT_VALIDATION_TIMEOUT_SECONDS);
        expect(config.getDataLoadTimeoutSeconds()).toBe(PersistenceConfig.DEFAULT_DATA_LOAD_TIMEOUT_SECONDS);
        expect(config.getRebalanceDelaySeconds()).toBe(PersistenceConfig.DEFAULT_REBALANCE_DELAY_SECONDS);
        expect(config.isAutoRemoveStaleData()).toBe(true);
        expect(config.getClusterDataRecoveryPolicy()).toBe('FULL_RECOVERY_ONLY');
    });

    test('setEnabled / isEnabled', () => {
        const config = new PersistenceConfig();
        config.setEnabled(true);
        expect(config.isEnabled()).toBe(true);
        config.setEnabled(false);
        expect(config.isEnabled()).toBe(false);
    });

    test('setBaseDir', () => {
        const config = new PersistenceConfig().setBaseDir('/data/helios');
        expect(config.getBaseDir()).toBe('/data/helios');
    });

    test('setBackupDir', () => {
        const config = new PersistenceConfig().setBackupDir('/backup');
        expect(config.getBackupDir()).toBe('/backup');
        config.setBackupDir(null);
        expect(config.getBackupDir()).toBeNull();
    });

    test('setParallelism enforces minimum of 1', () => {
        const config = new PersistenceConfig().setParallelism(0);
        expect(config.getParallelism()).toBe(1);

        config.setParallelism(-5);
        expect(config.getParallelism()).toBe(1);

        config.setParallelism(4);
        expect(config.getParallelism()).toBe(4);
    });

    test('setValidationTimeoutSeconds', () => {
        const config = new PersistenceConfig().setValidationTimeoutSeconds(60);
        expect(config.getValidationTimeoutSeconds()).toBe(60);
    });

    test('setDataLoadTimeoutSeconds', () => {
        const config = new PersistenceConfig().setDataLoadTimeoutSeconds(300);
        expect(config.getDataLoadTimeoutSeconds()).toBe(300);
    });

    test('setRebalanceDelaySeconds', () => {
        const config = new PersistenceConfig().setRebalanceDelaySeconds(30);
        expect(config.getRebalanceDelaySeconds()).toBe(30);
    });

    test('setAutoRemoveStaleData', () => {
        const config = new PersistenceConfig().setAutoRemoveStaleData(false);
        expect(config.isAutoRemoveStaleData()).toBe(false);
    });

    test('setClusterDataRecoveryPolicy', () => {
        const config = new PersistenceConfig().setClusterDataRecoveryPolicy('PARTIAL_RECOVERY_MOST_RECENT');
        expect(config.getClusterDataRecoveryPolicy()).toBe('PARTIAL_RECOVERY_MOST_RECENT');

        config.setClusterDataRecoveryPolicy('PARTIAL_RECOVERY_MOST_COMPLETE');
        expect(config.getClusterDataRecoveryPolicy()).toBe('PARTIAL_RECOVERY_MOST_COMPLETE');
    });

    test('fluent chaining returns this', () => {
        const config = new PersistenceConfig()
            .setEnabled(true)
            .setBaseDir('/data')
            .setBackupDir('/bak')
            .setParallelism(2)
            .setValidationTimeoutSeconds(100)
            .setDataLoadTimeoutSeconds(500)
            .setRebalanceDelaySeconds(10)
            .setAutoRemoveStaleData(false)
            .setClusterDataRecoveryPolicy('FULL_RECOVERY_ONLY');

        expect(config.isEnabled()).toBe(true);
        expect(config.getBaseDir()).toBe('/data');
        expect(config.getBackupDir()).toBe('/bak');
        expect(config.getParallelism()).toBe(2);
    });

    test('DEFAULT_BASE_DIR is helios-persistence', () => {
        expect(PersistenceConfig.DEFAULT_BASE_DIR).toBe('helios-persistence');
    });

    test('HeliosConfig integrates PersistenceConfig', async () => {
        const { HeliosConfig } = await import('@zenystx/helios-core/config/HeliosConfig');
        const config = new HeliosConfig('test');
        const pc = config.getPersistenceConfig();
        expect(pc).toBeInstanceOf(PersistenceConfig);
        expect(pc.isEnabled()).toBe(false);

        pc.setEnabled(true).setBaseDir('/custom');
        expect(config.getPersistenceConfig().getBaseDir()).toBe('/custom');
    });
});
