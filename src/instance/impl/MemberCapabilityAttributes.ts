import type { Member } from '@zenystx/helios-core/cluster/Member';

export const MONITOR_CAPABLE_ATTRIBUTE = 'helios.monitorCapable';
export const ADMIN_CAPABLE_ATTRIBUTE = 'helios.adminCapable';

export function createMemberCapabilityAttributes(args: {
  monitorCapable: boolean;
  adminCapable: boolean;
}): Map<string, string> {
  return new Map<string, string>([
    [MONITOR_CAPABLE_ATTRIBUTE, String(args.monitorCapable)],
    [ADMIN_CAPABLE_ATTRIBUTE, String(args.adminCapable)],
  ]);
}

export function readMemberMonitorCapability(member: Member): boolean | null {
  return readBooleanAttribute(member.getAttribute(MONITOR_CAPABLE_ATTRIBUTE));
}

export function readMemberAdminCapability(member: Member): boolean | null {
  return readBooleanAttribute(member.getAttribute(ADMIN_CAPABLE_ATTRIBUTE));
}

function readBooleanAttribute(value: string | null): boolean | null {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
}
