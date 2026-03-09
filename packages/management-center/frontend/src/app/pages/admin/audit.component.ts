import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe, JsonPipe } from '@angular/common';
import { ClusterStore } from '../../core/store/cluster.store';
import { ApiService, type AuditLogEntry } from '../../core/services/api.service';
import { SsrStateService } from '../../core/services/ssr-state.service';

@Component({
  selector: 'mc-audit',
  standalone: true,
  imports: [DatePipe, JsonPipe],
  template: `
    <div class="space-y-4 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Audit Log</h1>

      <div class="mc-panel">
        <table class="mc-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Cluster</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of entries(); track entry.id) {
              <tr>
                <td class="text-xs text-mc-text-dim whitespace-nowrap">{{ entry.createdAt | date:'medium' }}</td>
                <td>
                  <span class="mc-badge mc-badge-purple text-xs">{{ entry.actionType }}</span>
                </td>
                <td class="text-xs text-mc-text-dim">{{ entry.actorUserId ?? 'system' }}</td>
                <td class="text-xs text-mc-text-dim">
                  @if (entry.targetType) {
                    {{ entry.targetType }}: {{ entry.targetId }}
                  } @else {
                    -
                  }
                </td>
                <td class="text-xs text-mc-text-dim">{{ entry.clusterId ?? '-' }}</td>
                <td class="text-xs text-mc-text-dim max-w-xs truncate">{{ entry.detailsJson }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="text-center text-mc-text-muted py-8">No audit entries</td>
              </tr>
            }
          </tbody>
        </table>

        @if (hasMore()) {
          <div class="px-4 py-3 border-t border-mc-border text-center">
            <button
              class="mc-btn mc-btn-ghost text-xs"
              [disabled]="loadingMore()"
              (click)="loadMore()">
              {{ loadingMore() ? 'Loading...' : 'Load More' }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class AuditComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);
  private readonly ssrState = inject(SsrStateService);

  readonly entries = signal<AuditLogEntry[]>([]);
  readonly hasMore = signal(false);
  readonly loadingMore = signal(false);
  private nextCursor: string | null = null;
  private clusterId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.clusterId = this.route.parent?.snapshot.paramMap.get('id') ?? null;
    if (this.clusterId) {
      this.clusterStore.setActiveCluster(this.clusterId);
    }

    const ssrAudit = this.ssrState.getStateKey<AuditLogEntry[]>('auditLog');
    if (ssrAudit) {
      this.entries.set(ssrAudit);
      return;
    }

    await this.fetchEntries();
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor) return;
    this.loadingMore.set(true);
    await this.fetchEntries();
    this.loadingMore.set(false);
  }

  private async fetchEntries(): Promise<void> {
    try {
      const result = await this.apiService.getAuditLog(
        this.nextCursor ?? undefined,
        50,
        this.clusterId ? { clusterId: this.clusterId } : undefined,
      );
      this.entries.update(current => [...current, ...result.items]);
      this.nextCursor = result.nextCursor;
      this.hasMore.set(result.nextCursor !== null);
    } catch { /* handled by interceptor */ }
  }
}
