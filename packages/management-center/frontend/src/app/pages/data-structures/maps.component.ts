import { Component, OnInit, OnDestroy, inject, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { WebSocketService } from '../../core/services/websocket.service';
import { ClusterStore } from '../../core/store/cluster.store';

@Component({
  selector: 'mc-maps',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="space-y-4 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Maps</h1>

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
            @for (obj of maps(); track obj.name) {
              <tr>
                <td>
                  <a [routerLink]="[obj.name]" class="text-mc-blue hover:underline">{{ obj.name }}</a>
                </td>
                <td class="text-xs text-mc-text-dim">{{ obj.serviceName }}</td>
                <td class="text-xs text-mc-text-muted">
                  @if (mapStats()[obj.name]; as stats) {
                    {{ formatStats(stats) }}
                  } @else {
                    -
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="text-center text-mc-text-muted py-8">No maps found</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class MapsComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly wsService = inject(WebSocketService);
  private clusterId: string | null = null;

  readonly maps = computed(() => {
    const cluster = this.clusterStore.activeCluster();
    if (!cluster) return [];
    return cluster.distributedObjects.filter(o =>
      o.serviceName.includes('map') || o.serviceName.includes('Map'),
    );
  });

  readonly mapStats = computed(() => {
    const cluster = this.clusterStore.activeCluster();
    return (cluster?.mapStats ?? {}) as Record<string, Record<string, unknown>>;
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
    const entries = stats['ownedEntryCount'] ?? stats['entryCount'];
    if (entries !== undefined) return `${entries} entries`;
    return JSON.stringify(stats).slice(0, 60);
  }
}
