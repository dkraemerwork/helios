import { Component, OnInit, inject, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ClusterStore } from '../../core/store/cluster.store';

@Component({
  selector: 'mc-topics',
  standalone: true,
  template: `
    <div class="space-y-4 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Topics</h1>

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
            @for (obj of topics(); track obj.name) {
              <tr>
                <td class="font-mono text-xs">{{ obj.name }}</td>
                <td class="text-xs text-mc-text-dim">{{ obj.serviceName }}</td>
                <td class="text-xs text-mc-text-muted">
                  @if (topicStats()[obj.name]; as stats) {
                    {{ formatStats(stats) }}
                  } @else {
                    -
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="text-center text-mc-text-muted py-8">No topics found</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class TopicsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);

  readonly topics = computed(() => {
    const cluster = this.clusterStore.activeCluster();
    if (!cluster) return [];
    return cluster.distributedObjects.filter(o =>
      o.serviceName.includes('topic') || o.serviceName.includes('Topic'),
    );
  });

  readonly topicStats = computed(() => {
    const cluster = this.clusterStore.activeCluster();
    return (cluster?.topicStats ?? {}) as Record<string, Record<string, unknown>>;
  });

  ngOnInit(): void {
    const clusterId = this.route.parent?.snapshot.paramMap.get('id');
    if (clusterId) this.clusterStore.setActiveCluster(clusterId);
  }

  formatStats(stats: Record<string, unknown>): string {
    const published = stats['publishOperationCount'];
    if (published !== undefined) return `${published} published`;
    return JSON.stringify(stats).slice(0, 60);
  }
}
