import { EdgeType, type PipelineDescriptor } from './PipelineDescriptor.js';

export interface EdgeRoutingEntry {
  readonly edgeName: string;
  readonly edgeType: EdgeType;
  readonly subjectPattern: string;
  readonly memberSubjects: Record<string, string>;
  readonly broadcastSubject: string | null;
  readonly partitionCount: number;
}

export type EdgeRoutingTable = Map<string, EdgeRoutingEntry>;

export interface ExecutionPlan {
  readonly jobId: string;
  readonly pipeline: PipelineDescriptor;
  readonly memberIds: string[];
  readonly edgeRouting: EdgeRoutingTable;
  readonly fenceToken: string;
  readonly masterMemberId: string;
  readonly memberListVersion: number;
}

/**
 * Compute an execution plan from a pipeline descriptor and member topology.
 *
 * For each distributed edge in the DAG, computes NATS subject routing based on
 * the edge type. Local edges are skipped (they use in-process AsyncChannels).
 */
export function computeExecutionPlan(
  jobId: string,
  pipeline: PipelineDescriptor,
  memberIds: string[],
  authority: { fenceToken: string; masterMemberId: string; memberListVersion: number },
): ExecutionPlan {
  const edgeRouting: EdgeRoutingTable = new Map();

  for (const edgeDesc of pipeline.edges) {
    if (
      edgeDesc.edgeType === EdgeType.LOCAL ||
      edgeDesc.edgeType === EdgeType.LOCAL_PARTITIONED
    ) {
      continue;
    }

    const edgeName = `${edgeDesc.from}→${edgeDesc.to}`;
    const baseSubject = `__blitz.edge.${jobId}.${edgeDesc.from}.${edgeDesc.to}`;

    switch (edgeDesc.edgeType) {
      case EdgeType.DISTRIBUTED_UNICAST: {
        const memberSubjects: Record<string, string> = {};
        for (const memberId of memberIds) {
          memberSubjects[memberId] = `${baseSubject}.${memberId}`;
        }
        edgeRouting.set(edgeName, {
          edgeName,
          edgeType: EdgeType.DISTRIBUTED_UNICAST,
          subjectPattern: `${baseSubject}.*`,
          memberSubjects,
          broadcastSubject: null,
          partitionCount: 0,
        });
        break;
      }

      case EdgeType.DISTRIBUTED_PARTITIONED: {
        const partitionCount = memberIds.length * 4;
        const memberSubjects: Record<string, string> = {};
        for (const memberId of memberIds) {
          memberSubjects[memberId] = `${baseSubject}.${memberId}`;
        }
        edgeRouting.set(edgeName, {
          edgeName,
          edgeType: EdgeType.DISTRIBUTED_PARTITIONED,
          subjectPattern: `${baseSubject}.*`,
          memberSubjects,
          broadcastSubject: null,
          partitionCount,
        });
        break;
      }

      case EdgeType.DISTRIBUTED_BROADCAST: {
        const broadcastSubject = `${baseSubject}.broadcast`;
        const memberSubjects: Record<string, string> = {};
        for (const memberId of memberIds) {
          memberSubjects[memberId] = broadcastSubject;
        }
        edgeRouting.set(edgeName, {
          edgeName,
          edgeType: EdgeType.DISTRIBUTED_BROADCAST,
          subjectPattern: broadcastSubject,
          memberSubjects,
          broadcastSubject,
          partitionCount: 0,
        });
        break;
      }

      case EdgeType.ALL_TO_ONE: {
        const targetMember = memberIds[0];
        const targetSubject = `${baseSubject}.${targetMember}`;
        edgeRouting.set(edgeName, {
          edgeName,
          edgeType: EdgeType.ALL_TO_ONE,
          subjectPattern: targetSubject,
          memberSubjects: { [targetMember]: targetSubject },
          broadcastSubject: null,
          partitionCount: 0,
        });
        break;
      }
    }
  }

  return {
    jobId,
    pipeline,
    memberIds,
    edgeRouting,
    fenceToken: authority.fenceToken,
    masterMemberId: authority.masterMemberId,
    memberListVersion: authority.memberListVersion,
  };
}
