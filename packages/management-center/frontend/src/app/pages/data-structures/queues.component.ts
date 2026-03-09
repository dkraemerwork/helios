import { Component, OnInit, OnDestroy, inject, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { WebSocketService } from '../../core/services/websocket.service';
import { ClusterStore } from '../../core/store/cluster.store';

@Component({
  selector: 'mc-queues',
  standalone: true,
  template: `
    <div class="space-y-4 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Queues</h1>

      <div class="mc-panel">
        <table class="mc-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            @for (obj of queues(); track obj.name) {
              <tr>
                <td class="font-mono text-xs">{{ obj.name }}</td>
                <td class="text-xs text-mc-text-dim">{{ obj.serviceName }}</td>
                <td class="text-xs text-mc-text-muted">
                  @if (queueStats()[obj.name]; as stats) {
                    {{ formatStats(stats) }}
                  } @else {
                    -
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="text-center text-mc-text-muted py-8">No queues found</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class QueuesComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly wsService = inject(WebSocketService);
  private clusterId: string | null = null;

  readonly queues = computed(() => {
    const cluster = this.clusterStore.activeCluster();
    if (!cluster) return [];
    return cluster.distributedObjects.filter(o =>
      o.serviceName.includes('queue') || o.serviceName.includes('Queue'),
    );
  });

  readonly queueStats = computed(() => {
    const cluster = this.clusterStore.activeCluster();
    return (cluster?.queueStats ?? {}) as Record<string, Record<string, unknown>>;
  });

  ngOnInit(): void {
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

  formatStats(stats: Record<string, unknown>): string {
    const size = stats['ownedItemCount'] ?? stats['size'];
    if (size !== undefined) return `${size} items`;
    return JSON.stringify(stats).slice(0, 60);
  }
}
