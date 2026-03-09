import { Component, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { ClusterStore } from '../core/store/cluster.store';

/**
 * Dropdown to switch between clusters without full page reload.
 * Changes the active cluster in the store and navigates to the
 * same sub-route under the new cluster.
 */
@Component({
  selector: 'mc-cluster-switcher',
  standalone: true,
  template: `
    <div class="relative">
      <button
        class="flex items-center gap-2 px-3 py-2 rounded-md bg-mc-bg border border-mc-border hover:border-mc-border-hover text-sm text-mc-text transition-colors"
        (click)="dropdownOpen.set(!dropdownOpen())">
        <!-- Cluster state dot -->
        @if (activeCluster(); as cluster) {
          <span
            class="mc-status-dot"
            [class.mc-status-healthy]="cluster.clusterState === 'ACTIVE'"
            [class.mc-status-warning]="cluster.clusterState === 'PASSIVE' || cluster.clusterState === 'FROZEN'"
            [class.mc-status-unknown]="cluster.clusterState === 'UNKNOWN'">
          </span>
          <span class="font-medium">{{ cluster.clusterName || cluster.clusterId }}</span>
          <span class="text-mc-text-muted text-xs">({{ cluster.clusterSize }})</span>
        } @else {
          <span class="text-mc-text-muted">Select cluster</span>
        }
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-mc-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- Dropdown -->
      @if (dropdownOpen()) {
        <div class="absolute top-full left-0 mt-1 w-72 mc-panel shadow-lg z-50 animate-fade-in">
          <div class="py-1">
            @for (cluster of clusterList(); track cluster.clusterId) {
              <button
                class="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left hover:bg-mc-blue/5 transition-colors"
                [class.bg-mc-blue/10]="cluster.clusterId === activeClusterId()"
                (click)="switchCluster(cluster.clusterId)">
                <span
                  class="mc-status-dot flex-shrink-0"
                  [class.mc-status-healthy]="cluster.clusterState === 'ACTIVE'"
                  [class.mc-status-warning]="cluster.clusterState === 'PASSIVE' || cluster.clusterState === 'FROZEN'"
                  [class.mc-status-unknown]="cluster.clusterState === 'UNKNOWN'">
                </span>
                <div class="flex-1 min-w-0">
                  <div class="text-mc-text font-medium truncate">{{ cluster.clusterName || cluster.clusterId }}</div>
                  <div class="text-xs text-mc-text-muted">
                    {{ cluster.connectedMembers }}/{{ cluster.totalMembers }} members
                  </div>
                </div>
                <span class="text-xs mc-badge"
                  [class.mc-badge-emerald]="cluster.clusterState === 'ACTIVE'"
                  [class.mc-badge-amber]="cluster.clusterState !== 'ACTIVE'">
                  {{ cluster.clusterState }}
                </span>
              </button>
            }
            @if (clusterList().length === 0) {
              <div class="px-4 py-3 text-sm text-mc-text-muted text-center">No clusters connected</div>
            }
          </div>
        </div>
      }
    </div>
  `,
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class ClusterSwitcherComponent {
  private readonly router = inject(Router);
  private readonly clusterStore = inject(ClusterStore);

  readonly dropdownOpen = signal(false);
  readonly activeClusterId = this.clusterStore.activeClusterId;
  readonly clusterList = this.clusterStore.clusterList;

  readonly activeCluster = computed(() => {
    const id = this.activeClusterId();
    if (!id) return null;
    return this.clusterList().find(c => c.clusterId === id) ?? null;
  });

  switchCluster(clusterId: string): void {
    this.dropdownOpen.set(false);
    this.clusterStore.setActiveCluster(clusterId);

    // Navigate to the same sub-route under the new cluster
    const currentUrl = this.router.url;
    const match = currentUrl.match(/^\/clusters\/[^/]+(\/.*)?$/);
    const subRoute = match?.[1] ?? '';

    this.router.navigate([`/clusters/${clusterId}${subRoute}`]);
  }

  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('mc-cluster-switcher')) {
      this.dropdownOpen.set(false);
    }
  }
}
