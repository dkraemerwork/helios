import { Component, OnInit, OnDestroy, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { SidenavComponent } from './sidenav.component';
import { HeaderComponent } from './header.component';
import { BreadcrumbComponent } from './breadcrumb.component';
import { AuthService } from '../core/services/auth.service';
import { WebSocketService } from '../core/services/websocket.service';
import { ClusterStore } from '../core/store/cluster.store';
import { SsrStateService } from '../core/services/ssr-state.service';

/**
 * Top-level layout for authenticated routes.
 * Provides the sidenav, header, breadcrumb, and content area.
 * Initializes the WebSocket connection and hydrates the store from SSR state.
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
  private readonly authService = inject(AuthService);
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
}
