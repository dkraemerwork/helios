import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ClusterStore } from '../../core/store/cluster.store';
import { ApiService, type JobSnapshot } from '../../core/services/api.service';
import { SsrStateService } from '../../core/services/ssr-state.service';

@Component({
  selector: 'mc-jobs',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <div class="space-y-4 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Jobs</h1>

      @if (loading()) {
        <div class="text-center py-8 text-mc-text-muted">Loading jobs...</div>
      } @else {
        <div class="mc-panel">
          <table class="mc-table">
            <thead>
              <tr>
                <th>Job Name</th>
                <th>ID</th>
                <th>Status</th>
                <th>Started</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              @for (job of jobs(); track job.jobId) {
                <tr>
                  <td>
                    <a [routerLink]="[job.jobId]" class="text-mc-blue hover:underline">{{ job.jobName }}</a>
                  </td>
                  <td class="text-xs text-mc-text-dim font-mono">{{ job.jobId }}</td>
                  <td>
                    <span class="mc-badge"
                      [class.mc-badge-emerald]="job.status === 'RUNNING'"
                      [class.mc-badge-blue]="job.status === 'COMPLETED'"
                      [class.mc-badge-red]="job.status === 'FAILED'"
                      [class.mc-badge-amber]="job.status === 'SUSPENDED'">
                      {{ job.status }}
                    </span>
                  </td>
                  <td class="text-xs text-mc-text-dim">{{ job.executionStartTime | date:'medium' }}</td>
                  <td class="text-xs text-mc-text-dim">{{ job.completionTime ? (job.completionTime | date:'medium') : '-' }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="text-center text-mc-text-muted py-8">No jobs found</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class JobsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);
  private readonly ssrState = inject(SsrStateService);

  readonly jobs = signal<JobSnapshot[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    const clusterId = this.route.parent?.snapshot.paramMap.get('id');
    if (clusterId) {
      this.clusterStore.setActiveCluster(clusterId);
    }

    // Try SSR state first
    const ssrJobs = this.ssrState.getStateKey<JobSnapshot[]>('activeJobs');
    if (ssrJobs) {
      this.jobs.set(ssrJobs);
      this.loading.set(false);
      return;
    }

    // No SSR data available — jobs are loaded via WebSocket initial payload
    this.loading.set(false);
  }
}
