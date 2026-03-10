import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { JsonPipe } from '@angular/common';
import { ClusterStore } from '../../core/store/cluster.store';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'mc-config',
  standalone: true,
  imports: [JsonPipe],
  template: `
    <div class="space-y-4 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Configuration</h1>

      @if (loading()) {
        <div class="text-center py-8 text-mc-text-muted">Loading configuration...</div>
      } @else if (config()) {
        <div class="mc-panel p-4">
          <pre class="text-xs text-mc-text-dim overflow-x-auto leading-relaxed">{{ config() | json }}</pre>
        </div>
      } @else {
        <div class="text-center py-8 text-mc-text-muted">No configuration available</div>
      }
    </div>
  `,
})
export class ConfigComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly apiService = inject(ApiService);

  readonly config = signal<Record<string, unknown> | null>(null);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    const clusterId = this.route.parent?.snapshot.paramMap.get('id');
    if (clusterId) {
      this.clusterStore.setActiveCluster(clusterId);
      try {
        const cfg = await this.apiService.getClusterConfig(clusterId);
        this.config.set(cfg);
      } catch { /* handled by interceptor */ }
    }
    this.loading.set(false);
  }
}
