import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService, type CursorPaginated, type JobSnapshot } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ClusterStore } from '../../core/store/cluster.store';

interface JobMetricEntry {
  key: string;
  value: string;
}

interface JobVertexView {
  id: string;
  name: string;
  status: string;
  parallelism: number | null;
  processedItems: number | null;
  emittedItems: number | null;
}

interface JobEdgeView {
  source: string;
  target: string;
}

@Component({
  selector: 'mc-job-detail',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="space-y-6 animate-fade-in">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-mc-text">{{ jobName() || 'Job Details' }}</h1>
          <p class="mt-1 font-mono text-xs text-mc-text-dim">{{ jobId }}</p>
        </div>

        @if (authService.hasRole('operator', 'admin')) {
          <div class="flex gap-2">
            <button class="mc-btn mc-btn-ghost text-xs" [disabled]="actionLoading() || !supportsRestart() || !clusterId" (click)="restartJob()">
              Restart
            </button>
            <button class="mc-btn mc-btn-danger text-xs" [disabled]="actionLoading() || !supportsCancel() || !clusterId" (click)="cancelJob()">
              Cancel
            </button>
          </div>
        }
      </div>

      @if (actionResult(); as result) {
        <div class="rounded-md p-3 text-sm" [class]="result.success ? 'bg-mc-emerald/10 text-mc-emerald' : 'bg-mc-red/10 text-mc-red'">
          {{ result.message }}
        </div>
      }

      @if (job(); as currentJob) {
        <div class="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <div class="space-y-6">
            <div class="mc-panel p-4">
              <h2 class="mb-4 text-sm font-semibold text-mc-text">Execution Overview</h2>
              <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div class="text-xs text-mc-text-muted">Status</div>
                  <div class="mt-1">
                    <span class="mc-badge" [class.mc-badge-emerald]="currentJob.status === 'RUNNING'" [class.mc-badge-blue]="currentJob.status === 'COMPLETED'" [class.mc-badge-red]="currentJob.status === 'FAILED'" [class.mc-badge-amber]="currentJob.status === 'SUSPENDED'">
                      {{ currentJob.status }}
                    </span>
                  </div>
                </div>
                <div>
                  <div class="text-xs text-mc-text-muted">Started</div>
                  <div class="mt-1 text-sm text-mc-text">{{ currentJob.executionStartTime ? (currentJob.executionStartTime | date:'medium') : '-' }}</div>
                </div>
                <div>
                  <div class="text-xs text-mc-text-muted">Completed</div>
                  <div class="mt-1 text-sm text-mc-text">{{ currentJob.completionTime ? (currentJob.completionTime | date:'medium') : '-' }}</div>
                </div>
                <div>
                  <div class="text-xs text-mc-text-muted">Snapshot</div>
                  <div class="mt-1 text-sm text-mc-text">{{ currentJob.timestamp | date:'medium' }}</div>
                </div>
              </div>
            </div>

            <div class="mc-panel p-4">
              <div class="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 class="text-sm font-semibold text-mc-text">Job Topology</h2>
                  <p class="mt-1 text-xs text-mc-text-dim">Rendered from the serialized DAG snapshot stored by Management Center.</p>
                </div>
                <div class="text-xs text-mc-text-dim">{{ topologyVertices().length }} vertices / {{ topologyEdges().length }} edges</div>
              </div>

              @if (topologyVertices().length > 0) {
                <div class="grid gap-3 md:grid-cols-2">
                  @for (vertex of topologyVertices(); track vertex.id) {
                    <div class="rounded-lg border border-mc-border bg-black/10 p-3">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <div class="text-sm font-medium text-mc-text">{{ vertex.name }}</div>
                          <div class="mt-1 font-mono text-[11px] text-mc-text-dim">{{ vertex.id }}</div>
                        </div>
                        <span class="mc-badge" [class.mc-badge-emerald]="vertex.status === 'RUNNING'" [class.mc-badge-blue]="vertex.status === 'COMPLETED'" [class.mc-badge-red]="vertex.status === 'FAILED'" [class.mc-badge-amber]="vertex.status !== 'RUNNING' && vertex.status !== 'COMPLETED' && vertex.status !== 'FAILED'">
                          {{ vertex.status }}
                        </span>
                      </div>

                      <div class="mt-3 grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <div class="text-mc-text-muted">Parallelism</div>
                          <div class="mt-1 text-mc-text">{{ vertex.parallelism ?? '-' }}</div>
                        </div>
                        <div>
                          <div class="text-mc-text-muted">Processed</div>
                          <div class="mt-1 text-mc-text">{{ vertex.processedItems ?? '-' }}</div>
                        </div>
                        <div>
                          <div class="text-mc-text-muted">Emitted</div>
                          <div class="mt-1 text-mc-text">{{ vertex.emittedItems ?? '-' }}</div>
                        </div>
                      </div>

                      @if (incomingEdges(vertex.id).length > 0 || outgoingEdges(vertex.id).length > 0) {
                        <div class="mt-3 border-t border-mc-border pt-3 text-[11px] text-mc-text-dim">
                          <div>In: {{ incomingEdges(vertex.id).join(', ') || '-' }}</div>
                          <div class="mt-1">Out: {{ outgoingEdges(vertex.id).join(', ') || '-' }}</div>
                        </div>
                      }
                    </div>
                  }
                </div>
              } @else {
                <div class="rounded-lg border border-dashed border-mc-border px-4 py-8 text-center text-sm text-mc-text-muted">
                  No topology vertices were exported for this snapshot.
                </div>
              }
            </div>

            <div class="mc-panel p-4">
              <div class="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 class="text-sm font-semibold text-mc-text">Recent Snapshots</h2>
                  <p class="mt-1 text-xs text-mc-text-dim">Most recent persisted snapshots for this job.</p>
                </div>
                @if (history().nextCursor) {
                  <button class="mc-btn mc-btn-ghost text-xs" [disabled]="historyLoading()" (click)="loadMoreHistory()">
                    Load More
                  </button>
                }
              </div>

              <table class="mc-table">
                <thead>
                  <tr>
                    <th>Captured</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  @for (entry of history().items; track entry.id ?? entry.timestamp) {
                    <tr>
                      <td class="text-xs text-mc-text-dim">{{ entry.timestamp | date:'medium' }}</td>
                      <td class="text-xs text-mc-text">{{ entry.status }}</td>
                      <td class="text-xs text-mc-text-dim">{{ entry.executionStartTime ? (entry.executionStartTime | date:'short') : '-' }}</td>
                      <td class="text-xs text-mc-text-dim">{{ entry.completionTime ? (entry.completionTime | date:'short') : '-' }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="4" class="py-8 text-center text-mc-text-muted">No persisted history available yet</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="space-y-6">
            <div class="mc-panel p-4">
              <h2 class="mb-4 text-sm font-semibold text-mc-text">Snapshot Flags</h2>
              <div class="space-y-3 text-sm text-mc-text">
                <div class="flex items-center justify-between gap-4">
                  <span>Light job</span>
                  <span class="font-medium">{{ currentJob.lightJob ? 'Yes' : 'No' }}</span>
                </div>
                <div class="flex items-center justify-between gap-4">
                  <span>Cancel supported</span>
                  <span class="font-medium">{{ currentJob.supportsCancel ? 'Yes' : 'No' }}</span>
                </div>
                <div class="flex items-center justify-between gap-4">
                  <span>Restart supported</span>
                  <span class="font-medium">{{ currentJob.supportsRestart ? 'Yes' : 'No' }}</span>
                </div>
              </div>
            </div>

            <div class="mc-panel p-4">
              <h2 class="mb-4 text-sm font-semibold text-mc-text">Metrics Snapshot</h2>
              <div class="space-y-3 text-xs">
                @for (metric of metricEntries(); track metric.key) {
                  <div class="flex items-start justify-between gap-4 border-b border-mc-border pb-2 last:border-b-0 last:pb-0">
                    <span class="font-mono text-mc-text-dim">{{ metric.key }}</span>
                    <span class="max-w-[12rem] break-all text-right text-mc-text">{{ metric.value }}</span>
                  </div>
                } @empty {
                  <div class="text-sm text-mc-text-muted">No metrics were exported for this snapshot.</div>
                }
              </div>
            </div>
          </div>
        </div>
      } @else {
        <div class="mc-panel p-6 text-sm text-mc-text-muted">Unable to load job details for this cluster.</div>
      }
    </div>
  `,
})
export class JobDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);
  readonly authService = inject(AuthService);

  jobId = '';
  clusterId: string | null = null;

  readonly job = signal<JobSnapshot | null>(null);
  readonly jobName = signal('');
  readonly supportsCancel = signal(true);
  readonly supportsRestart = signal(true);
  readonly actionLoading = signal(false);
  readonly actionResult = signal<{ success: boolean; message: string } | null>(null);
  readonly metricEntries = signal<JobMetricEntry[]>([]);
  readonly topologyVertices = signal<JobVertexView[]>([]);
  readonly topologyEdges = signal<JobEdgeView[]>([]);
  readonly history = signal<CursorPaginated<JobSnapshot>>({ items: [], nextCursor: null });
  readonly historyLoading = signal(false);

  async ngOnInit(): Promise<void> {
    this.jobId = this.route.snapshot.paramMap.get('jobId') ?? '';
    this.clusterId = this.route.parent?.snapshot.paramMap.get('id') ?? null;
    if (!this.clusterId) {
      return;
    }

    this.clusterStore.setActiveCluster(this.clusterId);
    await Promise.all([this.loadJob(), this.loadHistory()]);
  }

  async cancelJob(): Promise<void> {
    if (!this.clusterId) {
      return;
    }
    if (!confirm(`Are you sure you want to cancel job "${this.jobId}"?`)) return;
    await this.executeAction(() => this.apiService.cancelJob(this.clusterId!, this.jobId), 'Job cancelled');
  }

  async restartJob(): Promise<void> {
    if (!this.clusterId) {
      return;
    }
    if (!confirm(`Are you sure you want to restart job "${this.jobId}"?`)) return;
    await this.executeAction(() => this.apiService.restartJob(this.clusterId!, this.jobId), 'Job restarted');
  }

  async loadMoreHistory(): Promise<void> {
    const cursor = this.history().nextCursor;
    if (!this.clusterId || !cursor) {
      return;
    }

    this.historyLoading.set(true);
    try {
      const nextPage = await this.apiService.getJobHistory(this.clusterId, this.jobId, cursor, 20);
      this.history.update(current => ({
        items: [...current.items, ...nextPage.items],
        nextCursor: nextPage.nextCursor,
      }));
    } finally {
      this.historyLoading.set(false);
    }
  }

  incomingEdges(vertexId: string): string[] {
    return this.topologyEdges()
      .filter(edge => edge.target === vertexId)
      .map(edge => this.vertexLabel(edge.source));
  }

  outgoingEdges(vertexId: string): string[] {
    return this.topologyEdges()
      .filter(edge => edge.source === vertexId)
      .map(edge => this.vertexLabel(edge.target));
  }

  private async loadJob(): Promise<void> {
    if (!this.clusterId) {
      return;
    }

    const job = await this.apiService.getClusterJob(this.clusterId, this.jobId);
    this.job.set(job);
    if (!job) {
      return;
    }

    this.jobName.set(job.jobName);
    this.supportsCancel.set(job.supportsCancel);
    this.supportsRestart.set(job.supportsRestart);
    this.metricEntries.set(parseMetrics(job.metricsJson));
    this.topologyVertices.set(parseVertices(job.verticesJson));
    this.topologyEdges.set(parseEdges(job.edgesJson));
  }

  private async loadHistory(): Promise<void> {
    if (!this.clusterId) {
      return;
    }

    this.historyLoading.set(true);
    try {
      this.history.set(await this.apiService.getJobHistory(this.clusterId, this.jobId, undefined, 20));
    } finally {
      this.historyLoading.set(false);
    }
  }

  private vertexLabel(vertexId: string): string {
    const vertex = this.topologyVertices().find(candidate => candidate.id === vertexId);
    return vertex?.name ?? vertexId;
  }

  private async executeAction(fn: () => Promise<{ success: boolean }>, successMsg: string): Promise<void> {
    this.actionLoading.set(true);
    this.actionResult.set(null);
    try {
      const result = await fn();
      this.actionResult.set({ success: result.success, message: result.success ? successMsg : 'Action failed' });
    } catch (err) {
      this.actionResult.set({ success: false, message: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      this.actionLoading.set(false);
    }
  }
}

function parseMetrics(json: string): JobMetricEntry[] {
  const raw = parseJsonRecord(json);
  return Object.entries(raw).map(([key, value]) => ({ key, value: formatUnknown(value) }));
}

function parseVertices(json: string): JobVertexView[] {
  const parsed = parseJsonArray(json);
  return parsed.map((entry, index) => {
    const record = asRecord(entry);
    const id = asString(record['id']) || asString(record['name']) || `vertex-${index}`;
    return {
      id,
      name: asString(record['name']) || id,
      status: asString(record['status']) || 'UNKNOWN',
      parallelism: asNumber(record['parallelism']),
      processedItems: asNumber(record['processedItems'] ?? record['receivedCount']),
      emittedItems: asNumber(record['emittedItems'] ?? record['emittedCount']),
    };
  });
}

function parseEdges(json: string): JobEdgeView[] {
  const parsed = parseJsonArray(json);
  return parsed.map(entry => {
    const record = asRecord(entry);
    return {
      source: asString(record['source']) || asString(record['from']) || '',
      target: asString(record['target']) || asString(record['to']) || asString(record['destName']) || '',
    };
  }).filter(edge => edge.source.length > 0 && edge.target.length > 0);
}

function parseJsonArray(json: string): unknown[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '-';
  }
  return JSON.stringify(value);
}
