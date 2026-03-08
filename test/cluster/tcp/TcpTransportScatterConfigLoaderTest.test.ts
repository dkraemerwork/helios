import { parseRawConfig } from '@zenystx/helios-core/config/ConfigLoader';
import { TcpTransportScatterConfig } from '@zenystx/helios-core/config/TcpTransportScatterConfig';
import { describe, expect, test } from 'bun:test';

describe('ConfigLoader — tcp scatter config', () => {
    test('preserves scatter defaults when not configured', () => {
        const config = parseRawConfig({ name: 'scatter-defaults' });
        const scatter = config.getNetworkConfig().getTcpTransportScatterConfig();

        expect(scatter.isEnabled()).toBe(true);
        expect(scatter.getInputCapacityBytes()).toBe(TcpTransportScatterConfig.DEFAULT_INPUT_CAPACITY_BYTES);
        expect(scatter.getOutputCapacityBytes()).toBe(TcpTransportScatterConfig.DEFAULT_OUTPUT_CAPACITY_BYTES);
    });

    test('parses kebab-case tcp scatter options', () => {
        const config = parseRawConfig({
            name: 'scatter-kebab',
            network: {
                'tcp-scatter': {
                    enabled: false,
                    'input-capacity-bytes': 4096,
                    'output-capacity-bytes': 8192,
                },
            },
        });

        const scatter = config.getNetworkConfig().getTcpTransportScatterConfig();
        expect(scatter.isEnabled()).toBe(false);
        expect(scatter.getInputCapacityBytes()).toBe(4096);
        expect(scatter.getOutputCapacityBytes()).toBe(8192);
    });

    test('parses camelCase tcp scatter options', () => {
        const config = parseRawConfig({
            name: 'scatter-camel',
            network: {
                tcpScatter: {
                    enabled: true,
                    inputCapacityBytes: 2048,
                    outputCapacityBytes: 16384,
                },
            },
        });

        const scatter = config.getNetworkConfig().getTcpTransportScatterConfig();
        expect(scatter.isEnabled()).toBe(true);
        expect(scatter.getInputCapacityBytes()).toBe(2048);
        expect(scatter.getOutputCapacityBytes()).toBe(16384);
    });
});
