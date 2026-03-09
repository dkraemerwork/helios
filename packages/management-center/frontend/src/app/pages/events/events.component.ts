import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ClusterStore } from '../../core/store/cluster.store';
import { ApiService, type SystemEvent } from '../../core/services/api.service';
import { SsrStateService } from '../../core/services/ssr-state.service';

@Component({
  selector: 'mc-events',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="space-y-4 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Events</h1>

      <div class="mc-panel">
        <table class="mc-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Type</th>
              <th>Member</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            @for (event of events(); track event.id) {
              <tr>
                <td class="text-xs text-mc-text-dim whitespace-nowrap">{{ event.timestamp | date:'medium' }}</td>
                <td>
                  <span class="mc-badge mc-badge-blue text-xs">{{ event.eventType }}</span>
                </td>
                <td class="text-xs font-mono text-mc-text-dim">{{ event.memberAddr }}</td>
                <td class="text-sm">{{ event.message }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="text-center text-mc-text-muted py-8">No events recorded</td>
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
export class EventsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);
  private readonly ssrState = inject(SsrStateService);

  readonly events = signal<SystemEvent[]>([]);
  readonly hasMore = signal(false);
  readonly loadingMore = signal(false);
  private nextCursor: string | null = null;
  private clusterId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.clusterId = this.route.parent?.snapshot.paramMap.get('id') ?? null;
    if (this.clusterId) {
      this.clusterStore.setActiveCluster(this.clusterId);
    }

    const ssrEvents = this.ssrState.getStateKey<SystemEvent[]>('events');
    if (ssrEvents) {
      this.events.set(ssrEvents);
      return;
    }

    if (this.clusterId) {
      await this.fetchEvents();
    }
  }

  async loadMore(): Promise<void> {
    if (!this.clusterId || !this.nextCursor) return;
    this.loadingMore.set(true);
    await this.fetchEvents();
    this.loadingMore.set(false);
  }

  private async fetchEvents(): Promise<void> {
    if (!this.clusterId) return;
    try {
      const result = await this.apiService.getClusterEvents(this.clusterId, this.nextCursor ?? undefined, 50);
      this.events.update(current => [...current, ...result.items]);
      this.nextCursor = result.nextCursor;
      this.hasMore.set(result.nextCursor !== null);
    } catch { /* error handled by interceptor */ }
  }
}
