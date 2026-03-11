import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ClusterStore } from '../../core/store/cluster.store';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'mc-admin',
  standalone: true,
  template: `
    <div class="space-y-6 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Cluster Administration</h1>

      @if (actionResult(); as result) {
        <div class="p-3 rounded-md text-sm"
          [class]="result.success ? 'bg-mc-emerald/10 text-mc-emerald' : 'bg-mc-red/10 text-mc-red'">
          {{ result.message }}
        </div>
      }

      <!-- Cluster State -->
      <div class="mc-panel p-4">
        <h2 class="text-sm font-semibold text-mc-text mb-4">Cluster State Management</h2>
        <div class="flex gap-3">
          @for (state of clusterStates; track state) {
            <button
              class="mc-btn text-xs"
              [class.mc-btn-primary]="state === 'ACTIVE'"
              [class.mc-btn-ghost]="state !== 'ACTIVE'"
              [disabled]="actionLoading()"
              (click)="setClusterState(state)">
              Set {{ state }}
            </button>
          }
        </div>
      </div>

      <!-- System Operations -->
      <div class="mc-panel p-4">
        <h2 class="text-sm font-semibold text-mc-text mb-4">System Operations</h2>
        <div class="flex gap-3">
          <button
            class="mc-btn mc-btn-ghost text-xs"
            [disabled]="actionLoading()"
            (click)="triggerGc()">
            Trigger GC
          </button>
        </div>
      </div>
    </div>
  `,
})
export class AdminComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);

  readonly clusterStates = ['ACTIVE', 'PASSIVE', 'FROZEN'] as const;
  readonly actionLoading = signal(false);
  readonly actionResult = signal<{ success: boolean; message: string } | null>(null);

  private clusterId: string | null = null;

  ngOnInit(): void {
    this.clusterId = this.route.parent?.snapshot.paramMap.get('id') ?? null;
    if (this.clusterId) {
      this.clusterStore.setActiveCluster(this.clusterId);
    }
  }

  async setClusterState(state: 'ACTIVE' | 'PASSIVE' | 'FROZEN'): Promise<void> {
    if (!this.clusterId) return;
    if (!confirm(`Are you sure you want to set the cluster to ${state}?`)) return;

    this.actionLoading.set(true);
    this.actionResult.set(null);
    try {
      const result = await this.apiService.setClusterState(this.clusterId, state);
      this.actionResult.set({
        success: result.success,
        message: result.success ? `Cluster set to ${state}` : 'Failed to change cluster state',
      });
    } catch (err) {
      this.actionResult.set({
        success: false,
        message: err instanceof Error ? err.message : 'Action failed',
      });
    } finally {
      this.actionLoading.set(false);
    }
  }

  async triggerGc(): Promise<void> {
    if (!this.clusterId) return;
    this.actionLoading.set(true);
    this.actionResult.set(null);
    try {
      const result = await this.apiService.triggerGc(this.clusterId);
      this.actionResult.set({
        success: result.success,
        message: result.success ? 'GC triggered successfully' : 'GC trigger failed',
      });
    } catch (err) {
      this.actionResult.set({
        success: false,
        message: err instanceof Error ? err.message : 'Action failed',
      });
    } finally {
      this.actionLoading.set(false);
    }
  }
}
