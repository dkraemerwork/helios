import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ClusterStore } from '../../core/store/cluster.store';
import { ApiService, type AlertRule, type AlertHistoryRecord } from '../../core/services/api.service';
import { SsrStateService } from '../../core/services/ssr-state.service';

@Component({
  selector: 'mc-alerts',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="space-y-6 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Alerts</h1>

      <!-- Active alerts -->
      <div class="mc-panel">
        <div class="px-4 py-3 border-b border-mc-border">
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
                  <span class="mc-badge"
                    [class.mc-badge-red]="alert.severity === 'critical'"
                    [class.mc-badge-amber]="alert.severity === 'warning'">
                    {{ alert.severity }}
                  </span>
                </td>
                <td class="text-sm">{{ alert.message }}</td>
                <td class="text-xs font-mono text-mc-text-dim">{{ alert.memberAddr ?? 'cluster' }}</td>
                <td class="text-xs">{{ alert.metricValue }}</td>
                <td class="text-xs">{{ alert.threshold }}</td>
                <td class="text-xs text-mc-text-dim">{{ alert.firedAt | date:'short' }}</td>
                <td>
                  <button
                    class="mc-btn mc-btn-ghost text-xs py-1 px-2"
                    (click)="acknowledgeAlert(alert.id!)">
                    Acknowledge
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="text-center text-mc-text-muted py-8">No active alerts</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Alert rules -->
      <div class="mc-panel">
        <div class="px-4 py-3 border-b border-mc-border">
          <h2 class="text-sm font-semibold text-mc-text">Alert Rules ({{ alertRules().length }})</h2>
        </div>
        <table class="mc-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Metric</th>
              <th>Condition</th>
              <th>Severity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (rule of alertRules(); track rule.id) {
              <tr>
                <td class="text-sm font-medium text-mc-text">{{ rule.name }}</td>
                <td class="text-xs font-mono text-mc-text-dim">{{ rule.metric }}</td>
                <td class="text-xs text-mc-text-dim">{{ rule.operator }} {{ rule.threshold }} for {{ rule.durationSec }}s</td>
                <td>
                  <span class="mc-badge"
                    [class.mc-badge-red]="rule.severity === 'critical'"
                    [class.mc-badge-amber]="rule.severity === 'warning'">
                    {{ rule.severity }}
                  </span>
                </td>
                <td>
                  <span class="mc-badge"
                    [class.mc-badge-emerald]="rule.enabled"
                    [class.mc-badge-red]="!rule.enabled">
                    {{ rule.enabled ? 'Enabled' : 'Disabled' }}
                  </span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="text-center text-mc-text-muted py-8">No alert rules configured</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class AlertsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);
  private readonly ssrState = inject(SsrStateService);

  readonly activeAlerts = signal<AlertHistoryRecord[]>([]);
  readonly alertRules = signal<AlertRule[]>([]);

  async ngOnInit(): Promise<void> {
    const clusterId = this.route.parent?.snapshot.paramMap.get('id');
    if (clusterId) {
      this.clusterStore.setActiveCluster(clusterId);
    }

    // Try SSR state first
    const ssrAlerts = this.ssrState.getStateKey<AlertHistoryRecord[]>('activeAlerts');
    const ssrRules = this.ssrState.getStateKey<AlertRule[]>('alertRules');

    if (ssrAlerts) this.activeAlerts.set(ssrAlerts);
    if (ssrRules) this.alertRules.set(ssrRules);

    // Fetch from API if no SSR data
    if (!ssrAlerts && clusterId) {
      try {
        const alerts = await this.apiService.getActiveAlerts(clusterId);
        this.activeAlerts.set(alerts);
      } catch { /* handled by error interceptor */ }
    }

    if (!ssrRules && clusterId) {
      try {
        const rules = await this.apiService.getAlertRules(clusterId);
        this.alertRules.set(rules);
      } catch { /* handled by error interceptor */ }
    }
  }

  async acknowledgeAlert(alertId: number): Promise<void> {
    try {
      await this.apiService.acknowledgeAlert(alertId);
      this.activeAlerts.update(alerts => alerts.filter(a => a.id !== alertId));
    } catch {
      // Show error notification in production
    }
  }
}
