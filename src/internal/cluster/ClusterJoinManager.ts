import { JoinConfig } from '@zenystx/core/config/JoinConfig';
import {
    MemberAddress,
    DiscoveryConfig,
    DiscoveryProvider,
    HeliosDiscoveryResolver,
    AwsDiscoveryProvider,
    AzureDiscoveryProvider,
    GcpDiscoveryProvider,
    K8sDiscoveryProvider,
    StaticDiscoveryProvider,
    createDiscoveryResolver,
} from '@zenystx/core/discovery/HeliosDiscovery';

const DEFAULT_PORT = 5701;

function parseMemberAddress(raw: string): MemberAddress {
    const trimmed = raw.trim();
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx === -1) {
        return { host: trimmed, port: DEFAULT_PORT };
    }
    const host = trimmed.slice(0, colonIdx);
    const portStr = trimmed.slice(colonIdx + 1);
    const port = parseInt(portStr, 10);
    return { host, port: Number.isNaN(port) ? DEFAULT_PORT : port };
}

function aliasedConfigToDiscoveryConfig(
    providerName: 'aws' | 'azure' | 'gcp' | 'k8s',
    properties: Map<string, string>,
): DiscoveryConfig {
    const props: Record<string, string> = {};
    for (const [k, v] of properties) {
        props[k] = v;
    }
    return { provider: providerName, properties: props };
}

/**
 * Bridges the config-level JoinConfig to the HeliosDiscoveryResolver.
 * Supports: TCP-IP static members, AWS, GCP, Azure, Kubernetes cloud providers.
 */
export class ClusterJoinManager {
    private readonly _resolver: HeliosDiscoveryResolver;
    private readonly _providers: readonly DiscoveryProvider[];

    constructor(
        resolver?: HeliosDiscoveryResolver,
        providers?: readonly DiscoveryProvider[],
    ) {
        this._providers = providers ?? [];
        this._resolver = resolver ?? createDiscoveryResolver([
            new AwsDiscoveryProvider(),
            new AzureDiscoveryProvider(),
            new GcpDiscoveryProvider(),
            new K8sDiscoveryProvider(),
            new StaticDiscoveryProvider(),
        ]);
    }

    async resolveMembers(
        joinConfig: JoinConfig,
        signal?: AbortSignal,
    ): Promise<readonly MemberAddress[]> {
        const tcpIp = joinConfig.getTcpIpConfig();
        if (tcpIp.isEnabled()) {
            return tcpIp.getMembers().map(parseMemberAddress);
        }

        const discoveryConfig = this._buildDiscoveryConfig(joinConfig);
        if (discoveryConfig === null) {
            return [];
        }

        return this._resolver.resolve(
            { discoveryConfigs: [discoveryConfig] },
            this._providers,
            signal,
        );
    }

    private _buildDiscoveryConfig(joinConfig: JoinConfig): DiscoveryConfig | null {
        const aws = joinConfig.getAwsConfig();
        if (aws.isEnabled()) {
            return aliasedConfigToDiscoveryConfig('aws', aws.getProperties());
        }

        const gcp = joinConfig.getGcpConfig();
        if (gcp.isEnabled()) {
            return aliasedConfigToDiscoveryConfig('gcp', gcp.getProperties());
        }

        const azure = joinConfig.getAzureConfig();
        if (azure.isEnabled()) {
            return aliasedConfigToDiscoveryConfig('azure', azure.getProperties());
        }

        const k8s = joinConfig.getKubernetesConfig();
        if (k8s.isEnabled()) {
            return aliasedConfigToDiscoveryConfig('k8s', k8s.getProperties());
        }

        return null;
    }
}
