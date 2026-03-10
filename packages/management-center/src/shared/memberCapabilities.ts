import type { ClusterState, MemberInfo, MemberState } from './types.js';

function hasRestAdvertisement(info: MemberInfo): boolean {
  return info.restAddress !== null || info.restPort > 0;
}

export function isMonitorCapableMemberInfo(info: MemberInfo | null | undefined): boolean {
  if (info === null || info === undefined) {
    return false;
  }

  return info.monitorCapable ?? hasRestAdvertisement(info);
}

export function isAdminCapableMemberInfo(info: MemberInfo | null | undefined): boolean {
  if (info === null || info === undefined) {
    return false;
  }

  return info.adminCapable ?? isMonitorCapableMemberInfo(info);
}

export function isMonitorCapableMemberState(member: MemberState): boolean {
  return isMonitorCapableMemberInfo(member.info);
}

export function isAdminCapableMemberState(member: MemberState): boolean {
  return isAdminCapableMemberInfo(member.info);
}

export function getMonitorCapableMembers(state: ClusterState): MemberState[] {
  return Array.from(state.members.values()).filter(isMonitorCapableMemberState);
}

export function countMonitorCapableMembers(state: ClusterState): number {
  return getMonitorCapableMembers(state).length;
}

export function countConnectedMonitorCapableMembers(state: ClusterState): number {
  return getMonitorCapableMembers(state).filter(member => member.connected).length;
}

export function getConnectedMonitorCapableMembers(state: ClusterState): MemberState[] {
  return getMonitorCapableMembers(state).filter(member => member.connected);
}
