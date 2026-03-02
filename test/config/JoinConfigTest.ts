import { describe, it, expect } from 'bun:test';
import { JoinConfig, InvalidConfigurationException } from '@helios/config/JoinConfig';
import { DiscoveryStrategyConfig } from '@helios/config/DiscoveryStrategyConfig';

describe('JoinConfigTest', () => {

    function assertOk(
        autoDetection: boolean,
        tcp: boolean,
        multicast: boolean,
        aws: boolean,
        gcp: boolean,
        azure: boolean,
        kubernetes: boolean,
        eureka: boolean,
        discoveryConfig: boolean,
    ): void {
        const config = new JoinConfig();
        config.getAutoDetectionConfig().setEnabled(autoDetection);
        config.getMulticastConfig().setEnabled(multicast);
        config.getTcpIpConfig().setEnabled(tcp);
        config.getAwsConfig().setEnabled(aws);
        config.getGcpConfig().setEnabled(gcp);
        config.getAzureConfig().setEnabled(azure);
        config.getKubernetesConfig().setEnabled(kubernetes);
        config.getEurekaConfig().setEnabled(eureka);
        if (discoveryConfig) {
            config.getDiscoveryConfig().addDiscoveryStrategyConfig(new DiscoveryStrategyConfig());
        }
        expect(() => config.verify()).not.toThrow();
    }

    it('joinConfigTest', () => {
        assertOk(true, false, false, false, false, false, false, false, false);
        assertOk(true, true, false, false, false, false, false, false, false);
        assertOk(true, false, true, false, false, false, false, false, false);
        assertOk(true, false, false, true, false, false, false, false, false);
        assertOk(true, false, false, false, true, false, false, false, false);
        assertOk(true, false, false, false, false, true, false, false, false);
        assertOk(true, false, false, false, false, false, true, false, false);
        assertOk(true, false, false, false, false, false, false, true, false);
        assertOk(true, false, false, false, false, false, false, false, true);
        assertOk(false, false, false, false, false, false, false, false, true);
    });

    it('joinConfigTestWhenTwoJoinMethodEnabled', () => {
        const config = new JoinConfig();
        config.getMulticastConfig().setEnabled(true);
        config.getTcpIpConfig().setEnabled(true);
        expect(() => config.verify()).toThrow(InvalidConfigurationException);
    });

    it('joinConfigTestWhenGcpAndAwsEnabled', () => {
        const config = new JoinConfig();
        config.getMulticastConfig().setEnabled(false);
        config.getAwsConfig().setEnabled(true);
        config.getGcpConfig().setEnabled(true);
        expect(() => config.verify()).toThrow(InvalidConfigurationException);
    });

    it('joinConfigTestWhenMulticastAndDiscoveryStrategyEnabled', () => {
        const config = new JoinConfig();
        config.getMulticastConfig().setEnabled(true);
        config.getDiscoveryConfig().addDiscoveryStrategyConfig(new DiscoveryStrategyConfig());
        expect(() => config.verify()).toThrow(InvalidConfigurationException);
    });

    it('joinConfigTestWhenTcpIpAndDiscoveryStrategyEnabled', () => {
        const config = new JoinConfig();
        config.getMulticastConfig().setEnabled(false);
        config.getTcpIpConfig().setEnabled(true);
        config.getDiscoveryConfig().addDiscoveryStrategyConfig(new DiscoveryStrategyConfig());
        expect(() => config.verify()).toThrow(InvalidConfigurationException);
    });

    it('joinConfigTestWhenEurekaAndDiscoveryStrategyEnabled', () => {
        const config = new JoinConfig();
        config.getMulticastConfig().setEnabled(false);
        config.getEurekaConfig().setEnabled(true);
        config.getDiscoveryConfig().addDiscoveryStrategyConfig(new DiscoveryStrategyConfig());
        expect(() => config.verify()).toThrow(InvalidConfigurationException);
    });

});
