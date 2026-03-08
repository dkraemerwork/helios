import type { EdgeType, PipelineDescriptor } from './PipelineDescriptor.js';

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
