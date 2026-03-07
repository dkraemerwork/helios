import { JoinConfig } from '@zenystx/helios-core/config/JoinConfig';
import { ClusterJoinManager } from '@zenystx/helios-core/internal/cluster/ClusterJoinManager';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

describe('ClusterJoinManagerTest', () => {

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('resolveMembers_tcpIpEnabled_returnsStaticMembers', async () => {
        const joinConfig = new JoinConfig();
        joinConfig.getTcpIpConfig().setEnabled(true);
        joinConfig.getTcpIpConfig().setMembers(['10.0.0.1:5701', '10.0.0.2']);

        const manager = new ClusterJoinManager();
        const members = await manager.resolveMembers(joinConfig);

        expect(members).toHaveLength(2);
        expect(members[0]).toEqual({ host: '10.0.0.1', port: 5701 });
        expect(members[1]).toEqual({ host: '10.0.0.2', port: 5701 });
    });

    it('resolveMembers_tcpIpEnabled_emptyMemberList_returnsEmpty', async () => {
        const joinConfig = new JoinConfig();
        joinConfig.getTcpIpConfig().setEnabled(true);

        const manager = new ClusterJoinManager();
        const members = await manager.resolveMembers(joinConfig);

        expect(members).toHaveLength(0);
    });

    it('resolveMembers_awsEnabled_callsAwsDiscovery', async () => {
        const mockReservations = {
            Reservations: [
                { Instances: [{ PrivateIpAddress: '172.16.0.1', State: { Name: 'running' } }] },
            ],
        };
        globalThis.fetch = mock(async () =>
            new Response(JSON.stringify(mockReservations), { status: 200 }),
        ) as unknown as typeof fetch;

        const joinConfig = new JoinConfig();
        joinConfig.getAwsConfig().setEnabled(true);
        joinConfig.getAwsConfig().setProperty('region', 'us-west-2');
        joinConfig.getAwsConfig().setProperty('port', '5701');

        const manager = new ClusterJoinManager();
        const members = await manager.resolveMembers(joinConfig);

        expect(members).toHaveLength(1);
        expect(members[0]).toEqual({ host: '172.16.0.1', port: 5701 });
    });

    it('resolveMembers_gcpEnabled_callsGcpDiscovery', async () => {
        const mockData = {
            items: [
                { networkInterfaces: [{ networkIP: '10.128.0.5' }] },
                { networkInterfaces: [{ networkIP: '10.128.0.6' }] },
            ],
        };
        globalThis.fetch = mock(async () =>
            new Response(JSON.stringify(mockData), { status: 200 }),
        ) as unknown as typeof fetch;

        const joinConfig = new JoinConfig();
        joinConfig.getGcpConfig().setEnabled(true);
        joinConfig.getGcpConfig().setProperty('project', 'my-project');
        joinConfig.getGcpConfig().setProperty('zone', 'us-central1-a');

        const manager = new ClusterJoinManager();
        const members = await manager.resolveMembers(joinConfig);

        expect(members).toHaveLength(2);
        expect(members[0]!.host).toBe('10.128.0.5');
        expect(members[1]!.host).toBe('10.128.0.6');
    });

    it('resolveMembers_noConfigEnabled_returnsEmpty', async () => {
        const joinConfig = new JoinConfig();
        // all configs disabled by default (autoDetection is enabled but not a join mechanism)

        const manager = new ClusterJoinManager();
        const members = await manager.resolveMembers(joinConfig);

        expect(members).toHaveLength(0);
    });

    it('resolveMembers_fetchFails_returnsEmpty', async () => {
        globalThis.fetch = mock(async () => { throw new Error('network error'); }) as unknown as typeof fetch;

        const joinConfig = new JoinConfig();
        joinConfig.getAwsConfig().setEnabled(true);

        const manager = new ClusterJoinManager();
        const members = await manager.resolveMembers(joinConfig);

        expect(members).toHaveLength(0);
    });

});
