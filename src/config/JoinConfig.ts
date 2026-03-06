import { MulticastConfig } from '@zenystx/core/config/MulticastConfig';
import { TcpIpConfig } from '@zenystx/core/config/TcpIpConfig';
import { AwsConfig } from '@zenystx/core/config/AwsConfig';
import { GcpConfig } from '@zenystx/core/config/GcpConfig';
import { AzureConfig } from '@zenystx/core/config/AzureConfig';
import { KubernetesConfig } from '@zenystx/core/config/KubernetesConfig';
import { EurekaConfig } from '@zenystx/core/config/EurekaConfig';
import { DiscoveryConfig } from '@zenystx/core/config/DiscoveryConfig';
import { AutoDetectionConfig } from '@zenystx/core/config/AutoDetectionConfig';

export class InvalidConfigurationException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidConfigurationException';
    }
}

export class JoinConfig {
    private _multicastConfig: MulticastConfig = new MulticastConfig();
    private _tcpIpConfig: TcpIpConfig = new TcpIpConfig();
    private _awsConfig: AwsConfig = new AwsConfig();
    private _gcpConfig: GcpConfig = new GcpConfig();
    private _azureConfig: AzureConfig = new AzureConfig();
    private _kubernetesConfig: KubernetesConfig = new KubernetesConfig();
    private _eurekaConfig: EurekaConfig = new EurekaConfig();
    private _discoveryConfig: DiscoveryConfig = new DiscoveryConfig();
    private _autoDetectionConfig: AutoDetectionConfig = new AutoDetectionConfig();

    getMulticastConfig(): MulticastConfig {
        return this._multicastConfig;
    }

    setMulticastConfig(multicastConfig: MulticastConfig): this {
        this._multicastConfig = multicastConfig;
        return this;
    }

    getTcpIpConfig(): TcpIpConfig {
        return this._tcpIpConfig;
    }

    setTcpIpConfig(tcpIpConfig: TcpIpConfig): this {
        this._tcpIpConfig = tcpIpConfig;
        return this;
    }

    getAwsConfig(): AwsConfig {
        return this._awsConfig;
    }

    setAwsConfig(awsConfig: AwsConfig): this {
        this._awsConfig = awsConfig;
        return this;
    }

    getGcpConfig(): GcpConfig {
        return this._gcpConfig;
    }

    setGcpConfig(gcpConfig: GcpConfig): this {
        this._gcpConfig = gcpConfig;
        return this;
    }

    getAzureConfig(): AzureConfig {
        return this._azureConfig;
    }

    setAzureConfig(azureConfig: AzureConfig): this {
        this._azureConfig = azureConfig;
        return this;
    }

    getKubernetesConfig(): KubernetesConfig {
        return this._kubernetesConfig;
    }

    setKubernetesConfig(kubernetesConfig: KubernetesConfig): this {
        this._kubernetesConfig = kubernetesConfig;
        return this;
    }

    getEurekaConfig(): EurekaConfig {
        return this._eurekaConfig;
    }

    setEurekaConfig(eurekaConfig: EurekaConfig): this {
        this._eurekaConfig = eurekaConfig;
        return this;
    }

    getDiscoveryConfig(): DiscoveryConfig {
        return this._discoveryConfig;
    }

    setDiscoveryConfig(discoveryConfig: DiscoveryConfig): this {
        this._discoveryConfig = discoveryConfig;
        return this;
    }

    getAutoDetectionConfig(): AutoDetectionConfig {
        return this._autoDetectionConfig;
    }

    setAutoDetectionConfig(autoDetectionConfig: AutoDetectionConfig): this {
        this._autoDetectionConfig = autoDetectionConfig;
        return this;
    }

    isAutoDetectionEnabled(): boolean {
        return this._autoDetectionConfig.isEnabled();
    }

    verify(): void {
        let enabledCount = 0;
        if (this._multicastConfig.isEnabled()) enabledCount++;
        if (this._tcpIpConfig.isEnabled()) enabledCount++;
        if (this._awsConfig.isEnabled()) enabledCount++;
        if (this._gcpConfig.isEnabled()) enabledCount++;
        if (this._azureConfig.isEnabled()) enabledCount++;
        if (this._kubernetesConfig.isEnabled()) enabledCount++;
        if (this._eurekaConfig.isEnabled()) enabledCount++;
        if (this._discoveryConfig.getDiscoveryStrategyConfigs().length > 0) enabledCount++;

        if (enabledCount > 1) {
            throw new InvalidConfigurationException(
                'Multiple join methods cannot be enabled at the same time. '
                + 'Only one of multicast, tcp-ip, aws, gcp, azure, kubernetes, eureka, or discovery can be enabled.'
            );
        }
    }
}
