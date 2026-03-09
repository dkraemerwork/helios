/**
 * Normalizes a raw Helios monitor payload into the MC internal MonitorPayload shape.
 *
 * The Helios core monitoring endpoint sends data in its own format:
 *   - `instanceName` (not `clusterName`)
 *   - `objects: {maps, queues, topics, executors}` (not `distributedObjects`)
 *   - `partitionCount` at top level (not `partitions: {partitionCount, memberPartitions}`)
 *   - `members[].{isMaster, isLocal}` (not `{liteMember, localMember, memberVersion}`)
 *   - `storeLatency` (not `mapStoreLatency`)
 *
 * This function transforms the raw shape into the internal MC MonitorPayload type.
 */

import type { MonitorPayload } from '../shared/types.js';

/**
 * Checks if a parsed object has the shape of a Helios monitor payload
 * (raw or already normalized).
 */
export function isHeliosPayload(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  const hasName = typeof record['clusterName'] === 'string' || typeof record['instanceName'] === 'string';
  return hasName && Array.isArray(record['members']);
}

/**
 * Transforms a raw Helios monitor payload into the MC internal MonitorPayload.
 */
export function normalizeHeliosPayload(raw: Record<string, unknown>): MonitorPayload {
  const r = raw;

  // clusterName <- instanceName (fallback)
  const clusterName = (r['clusterName'] as string | undefined)
    ?? (r['instanceName'] as string | undefined)
    ?? 'unknown';

  // distributedObjects <- objects: {maps, queues, topics, executors}
  let distributedObjects: MonitorPayload['distributedObjects'] = [];
  if (Array.isArray(r['distributedObjects'])) {
    distributedObjects = r['distributedObjects'] as MonitorPayload['distributedObjects'];
  } else if (r['objects'] && typeof r['objects'] === 'object') {
    const objs = r['objects'] as Record<string, string[]>;
    const serviceMap: Record<string, string> = {
      maps: 'hz:impl:mapService',
      queues: 'hz:impl:queueService',
      topics: 'hz:impl:topicService',
      executors: 'hz:impl:executorService',
    };
    for (const [key, serviceName] of Object.entries(serviceMap)) {
      const names = objs[key];
      if (Array.isArray(names)) {
        for (const name of names) {
          distributedObjects.push({ serviceName, name });
        }
      }
    }
  }

  // partitions <- partitionCount + member partition data
  let partitions: MonitorPayload['partitions'];
  if (r['partitions'] && typeof r['partitions'] === 'object') {
    partitions = r['partitions'] as MonitorPayload['partitions'];
  } else {
    const partitionCount = typeof r['partitionCount'] === 'number' ? r['partitionCount'] : 0;
    const memberPartitions: Record<string, { address: string; primaryPartitions: number[]; backupPartitions: number[] }> = {};
    const rawMembers = r['members'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(rawMembers)) {
      for (const m of rawMembers) {
        const addr = m['address'] as string;
        if (addr) {
          memberPartitions[addr] = {
            address: addr,
            primaryPartitions: Array.isArray(m['primaryPartitions']) ? m['primaryPartitions'] as number[] : [],
            backupPartitions: Array.isArray(m['backupPartitions']) ? m['backupPartitions'] as number[] : [],
          };
        }
      }
    }
    partitions = { partitionCount, memberPartitions };
  }

  // members normalization
  const rawMembers = r['members'] as Array<Record<string, unknown>> | undefined;
  const members = Array.isArray(rawMembers) ? rawMembers.map(m => ({
    address: (m['address'] as string) ?? '',
    liteMember: (m['liteMember'] as boolean) ?? !(m['isMaster'] as boolean ?? true),
    localMember: (m['localMember'] as boolean) ?? (m['isLocal'] as boolean) ?? false,
    uuid: (m['uuid'] as string) ?? '',
    memberVersion: (m['memberVersion'] as string) ?? (r['memberVersion'] as string) ?? '0.0.0',
  })) : [];

  return {
    instanceName: (r['instanceName'] as string) ?? clusterName,
    clusterName,
    clusterState: (r['clusterState'] as string) ?? 'UNKNOWN',
    clusterSize: (r['clusterSize'] as number) ?? 0,
    members,
    partitions,
    distributedObjects,
    samples: Array.isArray(r['samples']) ? r['samples'] as unknown[] : [],
    blitz: r['blitz'] as MonitorPayload['blitz'],
    mapStats: r['mapStats'] as Record<string, unknown>,
    queueStats: r['queueStats'] as Record<string, unknown>,
    topicStats: r['topicStats'] as Record<string, unknown>,
    mapStoreLatency: r['mapStoreLatency'] ?? r['storeLatency'],
    systemEvents: r['systemEvents'] as unknown[],
  };
}
