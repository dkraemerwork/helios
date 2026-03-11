import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { JsonPipe } from '@angular/common';
import { ClusterStore } from '../../core/store/cluster.store';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { WebSocketService } from '../../core/services/websocket.service';

@Component({
  selector: 'mc-map-detail',
  standalone: true,
  imports: [JsonPipe],
  template: `
    <div class="space-y-6 animate-fade-in">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold text-mc-text">Map: {{ mapName }}</h1>

        @if (authService.hasRole('operator', 'admin')) {
          <div class="flex gap-2">
            <button
              class="mc-btn mc-btn-ghost text-xs"
              [disabled]="actionLoading()"
              (click)="evictMap()">
              Evict All
            </button>
            <button
              class="mc-btn mc-btn-danger text-xs"
              [disabled]="actionLoading()"
              (click)="clearMap()">
              Clear Map
            </button>
          </div>
        }
      </div>

      @if (actionResult(); as result) {
        <div class="p-3 rounded-md text-sm"
          [class]="result.success ? 'bg-mc-emerald/10 text-mc-emerald' : 'bg-mc-red/10 text-mc-red'">
          {{ result.message }}
        </div>
      }

      <!-- Map stats -->
      @if (stats(); as s) {
        <div class="mc-panel p-4">
          <h2 class="text-sm font-semibold text-mc-text mb-3">Statistics</h2>
          <pre class="text-xs text-mc-text-dim overflow-x-auto">{{ s | json }}</pre>
        </div>
      }
    </div>
  `,
})
export class MapDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);
  private readonly wsService = inject(WebSocketService);
  readonly authService = inject(AuthService);

  mapName = '';
  private clusterId: string | null = null;
  readonly stats = computed(() => {
    const cluster = this.clusterStore.activeCluster();
    if (!cluster || !this.mapName) {
      return null;
    }
    return (cluster.mapStats[this.mapName] as Record<string, unknown>) ?? null;
  });
  readonly actionLoading = signal(false);
  readonly actionResult = signal<{ success: boolean; message: string } | null>(null);

  ngOnInit(): void {
    this.mapName = this.route.snapshot.paramMap.get('name') ?? '';
    this.clusterId = this.route.parent?.snapshot.paramMap.get('id') ?? null;
    if (this.clusterId) {
      this.clusterStore.setActiveCluster(this.clusterId);
      this.wsService.subscribe(this.clusterId, 'all');
    }
  }

  ngOnDestroy(): void {
    if (this.clusterId) {
      this.wsService.unsubscribe(this.clusterId);
    }
  }

  async clearMap(): Promise<void> {
    if (!this.clusterId) return;
    if (!confirm(`Are you sure you want to clear map "${this.mapName}"? This will delete all entries.`)) return;
    await this.executeAction(() => this.apiService.clearMap(this.clusterId!, this.mapName), 'Map cleared successfully');
  }

  async evictMap(): Promise<void> {
    if (!this.clusterId) return;
    if (!confirm(`Are you sure you want to evict all entries from map "${this.mapName}"?`)) return;
    await this.executeAction(() => this.apiService.evictMap(this.clusterId!, this.mapName), 'Map evicted successfully');
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
