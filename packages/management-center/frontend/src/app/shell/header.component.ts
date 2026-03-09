import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { WebSocketService } from '../core/services/websocket.service';
import { ClusterStore } from '../core/store/cluster.store';
import { ClusterSwitcherComponent } from './cluster-switcher.component';

/**
 * Top header bar with cluster status indicator, connection health,
 * user menu, and active alerts badge.
 */
@Component({
  selector: 'mc-header',
  standalone: true,
  imports: [ClusterSwitcherComponent],
  template: `
    <header class="flex items-center justify-between px-6 py-3 bg-mc-panel border-b border-mc-border">
      <!-- Left: Cluster switcher + status -->
      <div class="flex items-center gap-4">
        <mc-cluster-switcher />

        <!-- Connection status -->
        <div class="flex items-center gap-2 text-xs">
          <span
            class="mc-status-dot"
            [class.mc-status-healthy]="wsState() === 'connected'"
            [class.mc-status-warning]="wsState() === 'reconnecting' || wsState() === 'connecting'"
            [class.mc-status-unknown]="wsState() === 'disconnected'">
          </span>
          <span class="text-mc-text-muted">{{ wsStateLabel() }}</span>
        </div>
      </div>

      <!-- Right: Alerts + User menu -->
      <div class="flex items-center gap-4">
        <!-- Active alerts badge -->
        @if (activeAlertCount() > 0) {
          <button
            class="relative flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-mc-red/10 text-mc-red text-xs font-medium hover:bg-mc-red/20 transition-colors"
            (click)="navigateToAlerts()">
            <span>\u{1F514}</span>
            <span>{{ activeAlertCount() }} active</span>
          </button>
        }

        <!-- User menu -->
        @if (user(); as user) {
          <div class="flex items-center gap-3">
            <div class="text-right">
              <div class="text-sm text-mc-text font-medium">{{ user.displayName }}</div>
              <div class="text-xs text-mc-text-muted">{{ user.roles.join(', ') }}</div>
            </div>
            <button
              class="mc-btn-ghost text-xs px-2 py-1.5 rounded"
              (click)="logout()">
              Logout
            </button>
          </div>
        }
      </div>
    </header>
  `,
})
export class HeaderComponent {
  private readonly authService = inject(AuthService);
  private readonly wsService = inject(WebSocketService);
  private readonly clusterStore = inject(ClusterStore);
  private readonly router = inject(Router);

  readonly user = this.authService.currentUser;
  readonly wsState = this.wsService.connectionState;

  readonly wsStateLabel = computed(() => {
    switch (this.wsState()) {
      case 'connected': return 'Live';
      case 'connecting': return 'Connecting...';
      case 'reconnecting': return 'Reconnecting...';
      case 'disconnected': return 'Offline';
    }
  });

  readonly activeAlertCount = computed(() => {
    const cluster = this.clusterStore.activeCluster();
    return cluster?.activeAlertCount ?? 0;
  });

  navigateToAlerts(): void {
    const clusterId = this.clusterStore.activeClusterId();
    if (clusterId) {
      this.router.navigate(['/clusters', clusterId, 'alerts']);
    }
  }

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
