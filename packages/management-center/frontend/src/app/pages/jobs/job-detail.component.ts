import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe, JsonPipe } from '@angular/common';
import { ClusterStore } from '../../core/store/cluster.store';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'mc-job-detail',
  standalone: true,
  imports: [DatePipe, JsonPipe],
  template: `
    <div class="space-y-6 animate-fade-in">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-mc-text">{{ jobName() || 'Job Details' }}</h1>
          <p class="text-xs text-mc-text-dim font-mono mt-1">{{ jobId }}</p>
        </div>

        @if (authService.hasRole('operator', 'admin')) {
          <div class="flex gap-2">
            <button
              class="mc-btn mc-btn-ghost text-xs"
              [disabled]="actionLoading()"
              (click)="restartJob()">
              Restart
            </button>
            <button
              class="mc-btn mc-btn-danger text-xs"
              [disabled]="actionLoading()"
              (click)="cancelJob()">
              Cancel
            </button>
          </div>
        }
      </div>

      @if (actionResult(); as result) {
        <div class="p-3 rounded-md text-sm"
          [class.bg-mc-emerald/10]="result.success"
          [class.text-mc-emerald]="result.success"
          [class.bg-mc-red/10]="!result.success"
          [class.text-mc-red]="!result.success">
          {{ result.message }}
        </div>
      }

      <!-- Job metrics placeholder — will be enhanced with DAG visualization -->
      <div class="mc-panel p-4">
        <h2 class="text-sm font-semibold text-mc-text mb-3">Job Topology</h2>
        <div class="text-sm text-mc-text-muted py-8 text-center">
          DAG topology visualization will render here using elkjs layout engine.
        </div>
      </div>
    </div>
  `,
})
export class JobDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);
  readonly authService = inject(AuthService);

  jobId = '';
  readonly jobName = signal('');
  readonly actionLoading = signal(false);
  readonly actionResult = signal<{ success: boolean; message: string } | null>(null);

  ngOnInit(): void {
    this.jobId = this.route.snapshot.paramMap.get('jobId') ?? '';
    const clusterId = this.route.parent?.snapshot.paramMap.get('id');
    if (clusterId) {
      this.clusterStore.setActiveCluster(clusterId);
    }
  }

  async cancelJob(): Promise<void> {
    if (!confirm(`Are you sure you want to cancel job "${this.jobId}"?`)) return;
    await this.executeAction(() => this.apiService.cancelJob(this.jobId), 'Job cancelled');
  }

  async restartJob(): Promise<void> {
    if (!confirm(`Are you sure you want to restart job "${this.jobId}"?`)) return;
    await this.executeAction(() => this.apiService.restartJob(this.jobId), 'Job restarted');
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
