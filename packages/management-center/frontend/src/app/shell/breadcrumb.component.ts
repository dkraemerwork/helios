import { Component, inject, computed } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

interface BreadcrumbSegment {
  label: string;
  path: string;
}

/** Human-readable labels for known route segments. */
const SEGMENT_LABELS: Record<string, string> = {
  clusters: 'Clusters',
  members: 'Members',
  data: 'Data',
  maps: 'Maps',
  queues: 'Queues',
  topics: 'Topics',
  jobs: 'Jobs',
  alerts: 'Alerts',
  events: 'Events',
  config: 'Configuration',
  admin: 'Admin',
  audit: 'Audit Log',
  settings: 'Settings',
  users: 'Users',
  login: 'Login',
  'forgot-password': 'Forgot Password',
  'reset-password': 'Reset Password',
};

/**
 * Route-based breadcrumb component.
 * SSR-safe: uses the current router URL to derive breadcrumb segments.
 */
@Component({
  selector: 'mc-breadcrumb',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (segments().length > 0) {
      <nav class="flex items-center gap-1.5 text-xs text-mc-text-muted mb-4" aria-label="Breadcrumb">
        @for (segment of segments(); track segment.path; let last = $last) {
          @if (last) {
            <span class="text-mc-text font-medium">{{ segment.label }}</span>
          } @else {
            <a
              [routerLink]="segment.path"
              class="hover:text-mc-text transition-colors">
              {{ segment.label }}
            </a>
            <span class="text-mc-text-muted">/</span>
          }
        }
      </nav>
    }
  `,
})
export class BreadcrumbComponent {
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(event => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly segments = computed((): BreadcrumbSegment[] => {
    const url = this.currentUrl();
    const path = url.split('?')[0] ?? '';
    const parts = path.split('/').filter(Boolean);

    if (parts.length === 0) return [];

    const breadcrumbs: BreadcrumbSegment[] = [];
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i]!;
      currentPath += `/${segment}`;

      // Skip 'data' as a standalone breadcrumb — it's a grouping prefix
      if (segment === 'data') continue;

      const label = SEGMENT_LABELS[segment] ?? formatSegment(segment);
      breadcrumbs.push({ label, path: currentPath });
    }

    return breadcrumbs;
  });
}

/**
 * Formats a dynamic segment (like cluster ID or member address) for display.
 */
function formatSegment(segment: string): string {
  // If it looks like an IP:port, keep as-is
  if (segment.includes(':')) return segment;

  // Capitalize first letter
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}
