import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClusterStore } from '../../core/store/cluster.store';
import { WebSocketService } from '../../core/services/websocket.service';
import { ApiService, type MetricAggregate } from '../../core/services/api.service';
import { SsrStateService } from '../../core/services/ssr-state.service';

/**
 * Main cluster dashboard showing overview metrics, member status,
 * and cluster health at a glance.
 */
@Component({
  selector: 'mc-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="space-y-6 animate-fade-in">
      <!-- Cluster header -->
      @if (cluster(); as c) {
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-semibold text-mc-text">{{ c.clusterName || c.clusterId }}</h1>
            <p class="text-sm text-mc-text-dim mt-1">
              {{ c.members.size }} members &middot; {{ c.clusterSize }} partitions
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="mc-badge"
              [class.mc-badge-emerald]="c.clusterState === 'ACTIVE'"
              [class.mc-badge-amber]="c.clusterState === 'PASSIVE' || c.clusterState === 'FROZEN'">
              {{ c.clusterState }}
            </span>
          </div>
        </div>
      }

      <!-- KPI cards -->
      @if (cluster(); as c) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="mc-panel p-4">
            <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Members</div>
            <div class="text-2xl font-semibold text-mc-text">{{ connectedCount() }}/{{ c.members.size }}</div>
            <div class="text-xs text-mc-text-dim mt-1">connected</div>
          </div>
          <div class="mc-panel p-4">
            <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Avg CPU</div>
            <div class="text-2xl font-semibold text-mc-text">{{ avgCpu() | number:'1.1-1' }}%</div>
            <div class="text-xs text-mc-text-dim mt-1">cluster average</div>
          </div>
          <div class="mc-panel p-4">
            <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Avg Heap</div>
            <div class="text-2xl font-semibold text-mc-text">{{ avgHeapMb() | number:'1.0-0' }} MB</div>
            <div class="text-xs text-mc-text-dim mt-1">used across members</div>
          </div>
          <div class="mc-panel p-4">
            <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Active Alerts</div>
            <div class="text-2xl font-semibold"
              [class.text-mc-red]="c.activeAlertCount > 0"
              [class.text-mc-emerald]="c.activeAlertCount === 0">
              {{ c.activeAlertCount }}
            </div>
            <div class="text-xs text-mc-text-dim mt-1">
              <a [routerLink]="'alerts'" class="text-mc-blue hover:underline">View alerts</a>
            </div>
          </div>
        </div>
      }

      <!-- Members overview -->
      @if (members().length > 0) {
        <div class="mc-panel">
          <div class="flex items-center justify-between px-4 py-3 border-b border-mc-border">
            <h2 class="text-sm font-semibold text-mc-text">Members</h2>
            <a [routerLink]="'members'" class="text-xs text-mc-blue hover:underline">View all</a>
          </div>
          <table class="mc-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Status</th>
                <th>CPU</th>
                <th>Heap</th>
                <th>Event Loop p99</th>
              </tr>
            </thead>
            <tbody>
              @for (member of members(); track member.address) {
                <tr>
                  <td>
                    <a
                      [routerLink]="['members', member.address]"
                      class="text-mc-blue hover:underline font-mono text-xs">
                      {{ member.address }}
                    </a>
                  </td>
                  <td>
                    <span class="flex items-center gap-1.5">
                      <span class="mc-status-dot"
                        [class.mc-status-healthy]="member.connected"
                        [class.mc-status-critical]="!member.connected"></span>
                      {{ member.connected ? 'Connected' : 'Disconnected' }}
                    </span>
                  </td>
                  <td>{{ member.latestSample?.cpu?.percentUsed ?? '-' | number:'1.1-1' }}%</td>
                  <td>{{ (member.latestSample?.memory?.heapUsed ?? 0) / 1048576 | number:'1.0-0' }} MB</td>
                  <td>{{ member.latestSample?.eventLoop?.p99Ms ?? '-' | number:'1.1-1' }} ms</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly wsService = inject(WebSocketService);
  private readonly apiService = inject(ApiService);
  private readonly ssrState = inject(SsrStateService);

  readonly cluster = this.clusterStore.activeCluster;
  readonly members = this.clusterStore.members;

  readonly recentAggregates = signal<MetricAggregate[]>([]);

  readonly connectedCount = computed(() => {
    const m = this.members();
    return m.filter(member => member.connected).length;
  });

  readonly avgCpu = computed(() => {
    const m = this.members().filter(member => member.latestSample?.cpu);
    if (m.length === 0) return 0;
    const sum = m.reduce((acc, member) => acc + (member.latestSample?.cpu?.percentUsed ?? 0), 0);
    return sum / m.length;
  });

  readonly avgHeapMb = computed(() => {
    const m = this.members().filter(member => member.latestSample?.memory);
    if (m.length === 0) return 0;
    const sum = m.reduce((acc, member) => acc + (member.latestSample?.memory?.heapUsed ?? 0), 0);
    return sum / m.length / 1048576;
  });

  ngOnInit(): void {
    const clusterId = this.route.snapshot.paramMap.get('id');
    if (clusterId) {
      this.clusterStore.setActiveCluster(clusterId);
      this.wsService.subscribe(clusterId, 'all');

      // Load historical aggregates from SSR state or API
      const ssrAggregates = this.ssrState.getStateKey<MetricAggregate[]>('recentAggregates');
      if (ssrAggregates) {
        this.recentAggregates.set(ssrAggregates);
      } else {
        this.loadAggregates(clusterId);
      }
    }
  }

  ngOnDestroy(): void {
    const clusterId = this.clusterStore.activeClusterId();
    if (clusterId) {
      this.wsService.unsubscribe(clusterId);
    }
  }

  private async loadAggregates(clusterId: string): Promise<void> {
    try {
      const now = Date.now();
      const aggregates = await this.apiService.getMetricsHistory({
        clusterId,
        resolution: '1m',
        from: now - 3_600_000,
        to: now,
        limit: 60,
      });
      this.recentAggregates.set(aggregates);
    } catch {
      // Non-critical — dashboard still works with live data
    }
  }
}
