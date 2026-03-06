import { describe, it, expect } from 'bun:test';
import { TcpIpConfig } from '@zenystx/core/config/TcpIpConfig';

describe('TcpIpConfigTest', () => {

    it('testSetMembers_whenMembersSeparatedByDelimiter_AllMembersShouldBeAddedToMemberList', () => {
        const tcpIpConfig = new TcpIpConfig();
        const expectedMemberAddresses = ['10.11.12.1', '10.11.12.2', '10.11.12.3:5803', '10.11.12.4', '10.11.12.5', '10.11.12.6'];

        const memberAddresses = [' 10.11.12.1, 10.11.12.2', ' 10.11.12.3:5803 ;; 10.11.12.4, 10.11.12.5  10.11.12.6'];
        tcpIpConfig.setMembers(memberAddresses);
        expect(tcpIpConfig.getMembers()).toEqual(expectedMemberAddresses);
    });

    it('testAddMember_whenMembersSeparatedByDelimiter_AllMembersShouldBeAddedToMemberList', () => {
        const tcpIpConfig = new TcpIpConfig();
        const expectedMemberAddresses = ['10.11.12.1', '10.11.12.2', '10.11.12.3', '10.11.12.4', '10.11.12.5', '10.11.12.6', 'localhost:8803'];

        const members1 = ' 10.11.12.1,; 10.11.12.2';
        const members2 = ' 10.11.12.3 ;; 10.11.12.4 , 10.11.12.5  10.11.12.6   , localhost:8803';
        tcpIpConfig.addMember(members1);
        tcpIpConfig.addMember(members2);

        expect(tcpIpConfig.getMembers()).toEqual(expectedMemberAddresses);
    });

    it('testDefaultEnabled', () => {
        expect(new TcpIpConfig().isEnabled()).toBe(false);
    });

    it('testSetEnabled', () => {
        expect(new TcpIpConfig().setEnabled(true).isEnabled()).toBe(true);
    });

    it('testDefaultConnectionTimeout', () => {
        expect(new TcpIpConfig().getConnectionTimeoutSeconds()).toBe(5);
    });

    it('testSetConnectionTimeout', () => {
        expect(new TcpIpConfig().setConnectionTimeoutSeconds(10).getConnectionTimeoutSeconds()).toBe(10);
    });

});
