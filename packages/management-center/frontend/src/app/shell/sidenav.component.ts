import { Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { ClusterStore } from '../core/store/cluster.store';
import { resolveShellNavigationLink, type ShellNavigationScope } from './cluster-navigation';

interface NavItem {
  label: string;
  icon: string;
  path: string;
  scope?: ShellNavigationScope;
  roles?: Array<'viewer' | 'operator' | 'admin'>;
}

/**
 * Left sidebar navigation with role-aware menu items.
 * Items visibility is driven by the current user's roles.
 * Links are relative to the active cluster.
 */
@Component({
  selector: 'mc-sidenav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav
      class="flex flex-col h-full bg-mc-panel border-r border-mc-border transition-all duration-200"
      [class.w-64]="!collapsed()"
      [class.w-16]="collapsed()">

      <!-- Logo / Brand -->
      <div class="flex items-center gap-3 px-4 py-5 border-b border-mc-border">
        <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-mc-blue flex items-center justify-center">
          <span class="text-white font-bold text-sm">H</span>
        </div>
        @if (!collapsed()) {
          <span class="text-mc-text font-semibold text-sm truncate">Helios MC</span>
        }
      </div>

      <!-- Toggle button -->
      <button
        class="flex items-center justify-center p-2 mx-2 mt-2 rounded-md text-mc-text-dim hover:bg-mc-border-hover hover:text-mc-text transition-colors"
        (click)="toggle.emit()"
        [attr.aria-label]="collapsed() ? 'Expand navigation' : 'Collapse navigation'">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          @if (collapsed()) {
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          } @else {
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          }
        </svg>
      </button>

      <!-- Nav items -->
      <div class="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        @for (item of visibleItems(); track item.path) {
          <a
            [routerLink]="resolveNavLink(item)"
            routerLinkActive="bg-mc-blue/10 text-mc-blue border-mc-blue"
            class="flex items-center gap-3 px-3 py-2.5 rounded-md text-mc-text-dim hover:bg-mc-border-hover hover:text-mc-text transition-colors border border-transparent text-sm"
            [attr.title]="collapsed() ? item.label : null">
            <span class="flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs">{{ item.icon }}</span>
            @if (!collapsed()) {
              <span class="truncate">{{ item.label }}</span>
            }
          </a>
        }
      </div>

      <!-- Bottom section -->
      <div class="border-t border-mc-border py-3 px-2 space-y-1">
      </div>
    </nav>
  `,
})
export class SidenavComponent {
  readonly collapsed = input(false);
  readonly toggle = output<void>();

  readonly authService = inject(AuthService);
  private readonly clusterStore = inject(ClusterStore);
  private readonly router = inject(Router);

  private readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: '\u{1F4CA}', path: '' },
    { label: 'Members', icon: '\u{1F5A5}', path: '/members' },
    { label: 'Maps', icon: '\u{1F5C2}', path: '/data/maps' },
    { label: 'Queues', icon: '\u{1F4E5}', path: '/data/queues' },
    { label: 'Topics', icon: '\u{1F4E2}', path: '/data/topics' },
    { label: 'Jobs', icon: '\u26A1', path: '/jobs' },
    { label: 'Alerts', icon: '\u{1F514}', path: '/alerts' },
    { label: 'Events', icon: '\u{1F4C5}', path: '/events' },
    { label: 'Config', icon: '\u{1F527}', path: '/config' },
    { label: 'Admin', icon: '\u{1F6E0}', path: '/admin', roles: ['operator', 'admin'] },
    { label: 'Audit', icon: '\u{1F4DC}', path: '/audit', roles: ['admin'] },
    { label: 'Settings', icon: '\u2699', path: '/settings', scope: 'global' },
    { label: 'Users', icon: '\u{1F465}', path: '/users', scope: 'global', roles: ['admin'] },
  ];

  readonly visibleItems = computed(() =>
    this.navItems.filter(item => {
      if (!item.roles) return true;
      return item.roles.some(role => this.authService.hasRole(role));
    }),
  );

  resolveNavLink(item: NavItem): string {
    return resolveShellNavigationLink(
      item.path,
      item.scope ?? 'cluster',
      this.clusterStore.activeClusterId(),
      this.router.url,
    );
  }
}
