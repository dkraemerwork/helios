import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, type AlertHistoryRecord, type AlertRule } from '../../core/services/api.service';
import { SsrStateService } from '../../core/services/ssr-state.service';
import { WebSocketService } from '../../core/services/websocket.service';
import { ClusterStore } from '../../core/store/cluster.store';

type AlertMetric = AlertRule['metric'];
type AlertOperator = AlertRule['operator'];
type AlertSeverity = AlertRule['severity'];
type AlertScope = AlertRule['scope'];

interface AlertRuleDraft {
  name: string;
  severity: AlertSeverity;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  durationSec: number;
  cooldownSec: number;
  scope: AlertScope;
  stalenessWindowMs: number;
  deltaMode: boolean;
  runbookUrl: string;
}

@Component({
  selector: 'mc-alerts',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <div class="space-y-6 animate-fade-in">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-mc-text">Alerts</h1>
          <p class="mt-1 text-sm text-mc-text-dim">Create takeover rules, acknowledge active alerts, and review alert history.</p>
        </div>

        <button class="mc-btn mc-btn-ghost text-xs" [disabled]="loading()" (click)="refreshAll()">
          Refresh
        </button>
      </div>

      @if (actionResult(); as result) {
        <div class="rounded-md p-3 text-sm" [class]="result.success ? 'bg-mc-emerald/10 text-mc-emerald' : 'bg-mc-red/10 text-mc-red'">
          {{ result.message }}
        </div>
      }

      <div class="mc-panel p-4 space-y-4">
        <div>
          <h2 class="text-sm font-semibold text-mc-text">Create Alert Rule</h2>
          <p class="mt-1 text-xs text-mc-text-dim">Rules evaluate against the exported member metrics for the selected cluster.</p>
        </div>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label class="space-y-1 text-xs text-mc-text-dim">
            <span>Name</span>
            <input [(ngModel)]="draft.name" class="mc-input" placeholder="High event loop latency" />
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim">
            <span>Severity</span>
            <select [(ngModel)]="draft.severity" class="mc-input">
              @for (severity of severities; track severity) {
                <option [value]="severity">{{ severity }}</option>
              }
            </select>
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim xl:col-span-2">
            <span>Metric</span>
            <select [(ngModel)]="draft.metric" class="mc-input">
              @for (metric of metrics; track metric.value) {
                <option [value]="metric.value">{{ metric.label }}</option>
              }
            </select>
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim">
            <span>Operator</span>
            <select [(ngModel)]="draft.operator" class="mc-input">
              @for (operator of operators; track operator) {
                <option [value]="operator">{{ operator }}</option>
              }
            </select>
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim">
            <span>Threshold</span>
            <input [(ngModel)]="draft.threshold" class="mc-input" type="number" step="any" />
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim">
            <span>Duration (sec)</span>
            <input [(ngModel)]="draft.durationSec" class="mc-input" type="number" min="0" />
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim">
            <span>Cooldown (sec)</span>
            <input [(ngModel)]="draft.cooldownSec" class="mc-input" type="number" min="0" />
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim">
            <span>Scope</span>
            <select [(ngModel)]="draft.scope" class="mc-input">
              @for (scope of scopes; track scope.value) {
                <option [value]="scope.value">{{ scope.label }}</option>
              }
            </select>
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim">
            <span>Staleness Window (ms)</span>
            <input [(ngModel)]="draft.stalenessWindowMs" class="mc-input" type="number" min="0" />
          </label>

          <label class="space-y-1 text-xs text-mc-text-dim xl:col-span-2">
            <span>Runbook URL</span>
            <input [(ngModel)]="draft.runbookUrl" class="mc-input" placeholder="https://runbooks.example/alerts/high-event-loop" />
          </label>

          <label class="flex items-center gap-2 rounded-md border border-mc-border px-3 py-2 text-xs text-mc-text-dim">
            <input [(ngModel)]="draft.deltaMode" type="checkbox" />
            <span>Evaluate as delta metric</span>
          </label>
        </div>

        <div class="flex justify-end">
          <button class="mc-btn mc-btn-primary text-xs" [disabled]="loading() || !clusterId" (click)="createRule()">
            Create Rule
          </button>
        </div>
      </div>

      <div class="mc-panel">
        <div class="border-b border-mc-border px-4 py-3">
          <h2 class="text-sm font-semibold text-mc-text">Active Alerts ({{ activeAlerts().length }})</h2>
        </div>
        <table class="mc-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Message</th>
              <th>Member</th>
              <th>Value</th>
              <th>Threshold</th>
              <th>Fired At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (alert of activeAlerts(); track alert.id) {
              <tr>
                <td>
                  <span class="mc-badge" [class.mc-badge-red]="alert.severity === 'critical'" [class.mc-badge-amber]="alert.severity === 'warning'">
                    {{ alert.severity }}
                  </span>
                </td>
                <td class="text-sm text-mc-text">{{ alert.message }}</td>
                <td class="font-mono text-xs text-mc-text-dim">{{ alert.memberAddr ?? 'cluster' }}</td>
                <td class="text-xs">{{ formatNumber(alert.metricValue) }}</td>
                <td class="text-xs">{{ formatNumber(alert.threshold) }}</td>
                <td class="text-xs text-mc-text-dim">{{ alert.firedAt | date:'short' }}</td>
                <td>
                  <button class="mc-btn mc-btn-ghost px-2 py-1 text-xs" [disabled]="loading()" (click)="acknowledgeAlert(alert.id)">
                    Acknowledge
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="py-8 text-center text-mc-text-muted">No active alerts</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="mc-panel">
        <div class="border-b border-mc-border px-4 py-3">
          <h2 class="text-sm font-semibold text-mc-text">Alert Rules ({{ alertRules().length }})</h2>
        </div>
        <table class="mc-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Metric</th>
              <th>Condition</th>
              <th>Scope</th>
              <th>Severity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (rule of alertRules(); track rule.id) {
              <tr>
                <td class="text-sm font-medium text-mc-text">{{ rule.name }}</td>
                <td class="font-mono text-xs text-mc-text-dim">{{ rule.metric }}</td>
                <td class="text-xs text-mc-text-dim">{{ rule.operator }} {{ formatNumber(rule.threshold) }} for {{ rule.durationSec }}s</td>
                <td class="text-xs text-mc-text-dim">{{ formatScope(rule.scope) }}</td>
                <td>
                  <span class="mc-badge" [class.mc-badge-red]="rule.severity === 'critical'" [class.mc-badge-amber]="rule.severity === 'warning'">
                    {{ rule.severity }}
                  </span>
                </td>
                <td>
                  <span class="mc-badge" [class.mc-badge-emerald]="rule.enabled" [class.mc-badge-red]="!rule.enabled">
                    {{ rule.enabled ? 'Enabled' : 'Disabled' }}
                  </span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="py-8 text-center text-mc-text-muted">No alert rules configured</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="mc-panel">
        <div class="border-b border-mc-border px-4 py-3">
          <h2 class="text-sm font-semibold text-mc-text">Alert History ({{ alertHistory().length }})</h2>
        </div>
        <table class="mc-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Message</th>
              <th>Member</th>
              <th>Fired At</th>
              <th>Resolved</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (record of alertHistory(); track record.id) {
              <tr>
                <td>
                  <span class="mc-badge" [class.mc-badge-red]="record.severity === 'critical'" [class.mc-badge-amber]="record.severity === 'warning'">
                    {{ record.severity }}
                  </span>
                </td>
                <td class="text-sm text-mc-text">{{ record.message }}</td>
                <td class="font-mono text-xs text-mc-text-dim">{{ record.memberAddr ?? 'cluster' }}</td>
                <td class="text-xs text-mc-text-dim">{{ record.firedAt | date:'short' }}</td>
                <td class="text-xs text-mc-text-dim">{{ record.resolvedAt ? (record.resolvedAt | date:'short') : '-' }}</td>
                <td>
                  <span class="mc-badge" [class.mc-badge-blue]="record.resolvedAt !== null" [class.mc-badge-red]="record.resolvedAt === null">
                    {{ record.resolvedAt !== null ? 'Acknowledged / Resolved' : 'Active' }}
                  </span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="py-8 text-center text-mc-text-muted">No alert history yet</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class AlertsComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);
  private readonly ssrState = inject(SsrStateService);
  private readonly wsService = inject(WebSocketService);

  readonly activeAlerts = signal<AlertHistoryRecord[]>([]);
  readonly alertRules = signal<AlertRule[]>([]);
  readonly alertHistory = signal<AlertHistoryRecord[]>([]);
  readonly loading = signal(false);
  readonly actionResult = signal<{ success: boolean; message: string } | null>(null);

  clusterId: string | null = null;
  private readonly subscriptions = new Subscription();

  readonly severities: AlertSeverity[] = ['warning', 'critical'];
  readonly operators: AlertOperator[] = ['>', '>=', '<', '<=', '=='];
  readonly scopes: Array<{ value: AlertScope; label: string }> = [
    { value: 'any_member', label: 'Any member' },
    { value: 'all_members', label: 'All members' },
    { value: 'cluster_aggregate', label: 'Cluster aggregate' },
  ];
  readonly metrics: Array<{ value: AlertMetric; label: string }> = [
    { value: 'eventLoop.p99Ms', label: 'Event loop p99 (ms)' },
    { value: 'eventLoop.maxMs', label: 'Event loop max (ms)' },
    { value: 'cpu.percentUsed', label: 'CPU percent used' },
    { value: 'memory.heapUsedPercent', label: 'Heap used percent' },
    { value: 'memory.heapUsed', label: 'Heap used bytes' },
    { value: 'memory.rss', label: 'RSS bytes' },
    { value: 'operation.queueSize', label: 'Operation queue size' },
    { value: 'invocation.pendingCount', label: 'Invocation pending count' },
    { value: 'invocation.timeoutFailures', label: 'Invocation timeout failures' },
    { value: 'migration.activeMigrations', label: 'Active migrations' },
    { value: 'blitz.runningPipelines', label: 'Running pipelines' },
    { value: 'blitz.jobCounters.completedWithFailure', label: 'Failed blitz jobs' },
  ];

  draft: AlertRuleDraft = createDefaultDraft();

  async ngOnInit(): Promise<void> {
    this.clusterId = this.route.parent?.snapshot.paramMap.get('id') ?? null;
    if (this.clusterId) {
      this.clusterStore.setActiveCluster(this.clusterId);
      this.wsService.subscribe(this.clusterId, 'all');
      this.bindRealtimeRefresh(this.clusterId);
    }

    const ssrAlerts = this.ssrState.getStateKey<AlertHistoryRecord[]>('activeAlerts');
    const ssrRules = this.ssrState.getStateKey<AlertRule[]>('alertRules');
    const ssrHistory = this.ssrState.getStateKey<AlertHistoryRecord[]>('alertHistory');

    if (ssrAlerts) this.activeAlerts.set(ssrAlerts);
    if (ssrRules) this.alertRules.set(ssrRules);
    if (ssrHistory) this.alertHistory.set(ssrHistory);

    if (!ssrAlerts || !ssrRules || !ssrHistory) {
      await this.refreshAll();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.clusterId) {
      this.wsService.unsubscribe(this.clusterId);
    }
  }

  async refreshAll(): Promise<void> {
    if (!this.clusterId) {
      return;
    }

    this.loading.set(true);
    try {
      const [alerts, rules, history] = await Promise.all([
        this.apiService.getActiveAlerts(this.clusterId),
        this.apiService.getAlertRules(this.clusterId),
        this.apiService.getAlertHistory(undefined, 50, this.clusterId),
      ]);
      this.activeAlerts.set(alerts);
      this.alertRules.set(rules);
      this.alertHistory.set(history.items);
    } finally {
      this.loading.set(false);
    }
  }

  async createRule(): Promise<void> {
    if (!this.clusterId) {
      return;
    }

    const name = this.draft.name.trim();
    if (!name) {
      this.actionResult.set({ success: false, message: 'Rule name is required' });
      return;
    }

    this.loading.set(true);
    this.actionResult.set(null);
    try {
      await this.apiService.createAlertRule({
        clusterId: this.clusterId,
        name,
        severity: this.draft.severity,
        enabled: true,
        metric: this.draft.metric,
        operator: this.draft.operator,
        threshold: Number(this.draft.threshold),
        durationSec: Number(this.draft.durationSec),
        cooldownSec: Number(this.draft.cooldownSec),
        deltaMode: this.draft.deltaMode,
        scope: this.draft.scope,
        stalenessWindowMs: Number(this.draft.stalenessWindowMs),
        runbookUrl: this.draft.runbookUrl.trim() || undefined,
        actions: [],
      });
      this.actionResult.set({ success: true, message: `Created alert rule "${name}"` });
      this.draft = createDefaultDraft();
      await this.refreshAll();
    } catch (err) {
      this.actionResult.set({ success: false, message: err instanceof Error ? err.message : 'Failed to create alert rule' });
    } finally {
      this.loading.set(false);
    }
  }

  async acknowledgeAlert(alertId: number | undefined): Promise<void> {
    if (alertId === undefined) {
      return;
    }

    this.loading.set(true);
    this.actionResult.set(null);
    try {
      await this.apiService.acknowledgeAlert(alertId);
      this.actionResult.set({ success: true, message: `Acknowledged alert #${alertId}` });
      await this.refreshAll();
    } catch (err) {
      this.actionResult.set({ success: false, message: err instanceof Error ? err.message : 'Failed to acknowledge alert' });
    } finally {
      this.loading.set(false);
    }
  }

  formatScope(scope: AlertScope): string {
    const label = this.scopes.find(candidate => candidate.value === scope);
    return label?.label ?? scope;
  }

  formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  private bindRealtimeRefresh(clusterId: string): void {
    const refresh = (): void => {
      void this.refreshAll();
    };

    this.subscriptions.add(
      this.wsService.onMessage<{ clusterId: string }>('alert:fired').subscribe(payload => {
        if (payload.clusterId === clusterId) {
          refresh();
        }
      }),
    );
    this.subscriptions.add(
      this.wsService.onMessage<{ clusterId: string }>('alert:resolved').subscribe(payload => {
        if (payload.clusterId === clusterId) {
          refresh();
        }
      }),
    );
  }
}

function createDefaultDraft(): AlertRuleDraft {
  return {
    name: '',
    severity: 'critical',
    metric: 'eventLoop.p99Ms',
    operator: '>=',
    threshold: 250,
    durationSec: 30,
    cooldownSec: 300,
    scope: 'any_member',
    stalenessWindowMs: 30000,
    deltaMode: false,
    runbookUrl: '',
  };
}
