export enum JobStatus {
  NOT_RUNNING = 'NOT_RUNNING',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  COMPLETING = 'COMPLETING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  SUSPENDED_EXPORTING_SNAPSHOT = 'SUSPENDED_EXPORTING_SNAPSHOT',
  SUSPENDED = 'SUSPENDED',
  RESTARTING = 'RESTARTING',
}

const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
]);

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
