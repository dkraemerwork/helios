import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  // ── Public routes ──────────────────────────────────────────────────────
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/login/forgot-password.component').then(m => m.ForgotPasswordComponent),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/login/reset-password.component').then(m => m.ResetPasswordComponent),
  },

  // ── Protected routes (inside shell) ────────────────────────────────────
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shell/app-shell.component').then(m => m.AppShellComponent),
    children: [
      // ── Cluster routes ─────────────────────────────────────────────────
      {
        path: 'clusters/:id',
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
          },
          {
            path: 'members',
            loadComponent: () =>
              import('./pages/members/members.component').then(m => m.MembersComponent),
          },
          {
            path: 'members/:address',
            loadComponent: () =>
              import('./pages/members/member-detail.component').then(m => m.MemberDetailComponent),
          },
          {
            path: 'data/maps',
            loadComponent: () =>
              import('./pages/data-structures/maps.component').then(m => m.MapsComponent),
          },
          {
            path: 'data/maps/:name',
            loadComponent: () =>
              import('./pages/data-structures/map-detail.component').then(m => m.MapDetailComponent),
          },
          {
            path: 'data/queues',
            loadComponent: () =>
              import('./pages/data-structures/queues.component').then(m => m.QueuesComponent),
          },
          {
            path: 'data/topics',
            loadComponent: () =>
              import('./pages/data-structures/topics.component').then(m => m.TopicsComponent),
          },
          {
            path: 'jobs',
            loadComponent: () =>
              import('./pages/jobs/jobs.component').then(m => m.JobsComponent),
          },
          {
            path: 'jobs/:jobId',
            loadComponent: () =>
              import('./pages/jobs/job-detail.component').then(m => m.JobDetailComponent),
          },
          {
            path: 'alerts',
            loadComponent: () =>
              import('./pages/alerts/alerts.component').then(m => m.AlertsComponent),
          },
          {
            path: 'events',
            loadComponent: () =>
              import('./pages/events/events.component').then(m => m.EventsComponent),
          },
          {
            path: 'config',
            loadComponent: () =>
              import('./pages/config/config.component').then(m => m.ConfigComponent),
          },
          {
            path: 'admin',
            canActivate: [roleGuard],
            data: { requiredRoles: ['operator', 'admin'] },
            loadComponent: () =>
              import('./pages/admin/admin.component').then(m => m.AdminComponent),
          },
          {
            path: 'audit',
            canActivate: [roleGuard],
            data: { requiredRoles: ['admin'] },
            loadComponent: () =>
              import('./pages/admin/audit.component').then(m => m.AuditComponent),
          },
        ],
      },

      // ── Settings ─────────────────────────────────────────────────────
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/settings.component').then(m => m.SettingsComponent),
      },

      // ── Users (admin only) ───────────────────────────────────────────
      {
        path: 'users',
        canActivate: [roleGuard],
        data: { requiredRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/users/users.component').then(m => m.UsersComponent),
      },

      // ── Default redirect ─────────────────────────────────────────────
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'login',
      },
    ],
  },

  // ── Fallback ──────────────────────────────────────────────────────────
  {
    path: '**',
    redirectTo: 'login',
  },
];
