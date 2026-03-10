export const STRESS_MAP_NAME = 'stress-map';
export const NEAR_CACHE_MAP_NAME = 'near-cache-map';
export const HOT_MAP_NAME = 'hot-map';
export const COLD_MAP_NAME = 'cold-map';
export const STRESS_QUEUE_NAME = 'stress-queue';
export const STRESS_TOPIC_NAME = 'stress-topic';
export const STRESS_MEMBER_TOPIC_NAME = 'stress-member-topic';
export const STRESS_MEMBER_QUEUE_PREFIX = 'stress-member-queue';

export function getMemberQueuePrefix(nodeName: string): string {
  return `${STRESS_MEMBER_QUEUE_PREFIX}-${nodeName}`;
}

export function buildMemberQueueCandidates(nodeName: string, count = 32): string[] {
  const prefix = getMemberQueuePrefix(nodeName);
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}
