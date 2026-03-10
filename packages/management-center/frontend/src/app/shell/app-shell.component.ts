import { Component, OnInit, OnDestroy, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { SidenavComponent } from './sidenav.component';
import { HeaderComponent } from './header.component';
import { BreadcrumbComponent } from './breadcrumb.component';
import { AuthService } from '../core/services/auth.service';
import { ApiService } from '../core/services/api.service';
import { WebSocketService } from '../core/services/websocket.service';
import { ClusterStore } from '../core/store/cluster.store';
import { SsrStateService } from '../core/services/ssr-state.service';
import { resolvePlaceholderClusterUrl } from './cluster-navigation';

/**
 * Top-level layout for authenticated routes.
 * Provides the sidenav, header, breadcrumb, and content area.
 * Initializes the WebSocket connection, loads clusters from the API,
 * and hydrates the store from SSR state.
 */
@Component({
  selector: 'mc-app-shell',
  standalone: true,
  imports: [RouterOutlet, SidenavComponent, HeaderComponent, BreadcrumbComponent],
  template: `
    <div class="flex h-screen overflow-hidden bg-mc-bg">
      <mc-sidenav
        [collapsed]="sidenavCollapsed()"
        (toggle)="sidenavCollapsed.set(!sidenavCollapsed())" />

      <div class="flex flex-1 flex-col overflow-hidden">
        <mc-header />

        <main class="flex-1 overflow-y-auto p-6">
          <mc-breadcrumb />
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
    }
  `],
})
export class AppShellComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly apiService = inject(ApiService);
  private readonly wsService = inject(WebSocketService);
  private readonly clusterStore = inject(ClusterStore);
  private readonly ssrState = inject(SsrStateService);

  readonly sidenavCollapsed = signal(false);

  private wsSubscription: Subscription | null = null;

  async ngOnInit(): Promise<void> {
    // Hydrate store from SSR transfer state
    const transferState = this.ssrState.getTransferState();
    if (transferState) {
      this.clusterStore.initFromTransferState(transferState);
    }

    if (!isPlatformBrowser(this.platformId)) return;

    // Load clusters from the API and seed the store
    await this.loadClustersAndNavigate();

    // Connect WebSocket for live updates
    try {
      const ticket = await this.authService.requestWsTicket();
      this.wsService.connect(ticket);

      // Wire WS events into store
      this.wsSubscription = new Subscription();

      const events = [
        'cluster:update',
        'member:sample',
        'data:update',
        'jobs:update',
        'alert:fired',
        'alert:resolved',
      ];

      for (const event of events) {
        this.wsSubscription.add(
          this.wsService.onMessage(event).subscribe(data => {
            this.clusterStore.updateFromWs(event, data);
          }),
        );
      }
    } catch {
      // WS ticket request failed — user may need to re-authenticate.
      // The auth interceptor / guard will handle redirection.
    }
  }

  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.wsService.disconnect();
  }

  /**
   * Fetches the cluster list from the REST API, seeds the store,
   * and auto-navigates to the first cluster if the current route
   * is the shell root or contains the `_` placeholder.
   */
  private async loadClustersAndNavigate(): Promise<void> {
    try {
      const clusters = await this.apiService.getClusters();
      if (clusters.length === 0) return;

      // Seed the store with cluster summaries
      this.clusterStore.initFromTransferState({
        clusters: clusters.map(c => ({
          clusterId: c.clusterId,
          clusterName: c.clusterName,
          clusterState: c.clusterState,
          clusterSize: c.clusterSize,
          lastUpdated: c.lastUpdated,
          hasBlitz: c.hasBlitz,
        })),
      });

      // Set the first cluster as active
      const firstClusterId = clusters[0].clusterId;
      this.clusterStore.setActiveCluster(firstClusterId);

      // Navigate to the first cluster dashboard if the current route
      // is the shell root or uses the `_` placeholder
      const currentUrl = this.router.url;
      const nextUrl = resolvePlaceholderClusterUrl(currentUrl, firstClusterId);

      if (nextUrl !== currentUrl) {
        await this.router.navigateByUrl(nextUrl, { replaceUrl: true });
      }
    } catch {
      // Failed to load clusters — user will see an empty shell.
      // The WebSocket connection may still populate the store later.
    }
  }
}
