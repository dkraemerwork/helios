import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SsrStateService } from './ssr-state.service';

// ── API Types ────────────────────────────────────────────────────────────────

export interface McUser {
  id: string;
  email: string;
  displayName: string;
  roles: Array<'viewer' | 'operator' | 'admin'>;
  clusterScopes: string[];
}

interface LoginResponse {
  user: McUser;
}

interface MeResponse {
  user: McUser;
}

interface WsTicketResponse {
  ticket: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Manages authentication state, login/logout, session refresh,
 * and password recovery flows.
 *
 * Uses Angular signals for reactive state. The current user is populated
 * from SSR transfer state on hydration or from GET /api/auth/me on demand.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly ssrState = inject(SsrStateService);

  /** The currently authenticated user, or null. */
  private readonly _currentUser = signal<McUser | null>(null);
  private readonly _loading = signal(true);
  private initialized = false;

  readonly currentUser = this._currentUser.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly isAuthenticated = computed(() => this._currentUser() !== null);

  /** Check whether the current user has at least one of the given roles. */
  hasRole(...roles: Array<'viewer' | 'operator' | 'admin'>): boolean {
    const user = this._currentUser();
    if (!user) return false;
    return roles.some(role => user.roles.includes(role));
  }

  /** Check whether the current user has access to a specific cluster. */
  hasClusterAccess(clusterId: string): boolean {
    const user = this._currentUser();
    if (!user) return false;
    if (user.clusterScopes.includes('*')) return true;
    return user.clusterScopes.includes(clusterId);
  }

  /**
   * Initialize auth state. Tries SSR transfer state first,
   * then falls back to GET /api/auth/me.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Try hydrating from SSR transfer state
    const ssrUser = this.ssrState.getStateKey<McUser>('currentUser');
    if (ssrUser) {
      this._currentUser.set(ssrUser);
      this._loading.set(false);
      return;
    }

    // If on server, skip API call
    if (this.ssrState.isServer()) {
      this._loading.set(false);
      return;
    }

    // Fetch from API
    try {
      const res = await firstValueFrom(
        this.http.get<MeResponse>('/api/auth/me'),
      );
      this._currentUser.set(res.user);
    } catch {
      this._currentUser.set(null);
    } finally {
      this._loading.set(false);
    }
  }

  async login(email: string, password: string): Promise<McUser> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>('/api/auth/login', { email, password }),
    );
    this._currentUser.set(res.user);
    return res.user;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post<void>('/api/auth/logout', {}),
      );
    } finally {
      this._currentUser.set(null);
      this.router.navigate(['/login']);
    }
  }

  async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<LoginResponse>('/api/auth/refresh', {}),
      );
      this._currentUser.set(res.user);
    } catch {
      this._currentUser.set(null);
      this.router.navigate(['/login']);
    }
  }

  async forgotPassword(email: string): Promise<void> {
    await firstValueFrom(
      this.http.post<void>('/api/auth/forgot-password', { email }),
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post<void>('/api/auth/reset-password', { token, newPassword }),
    );
  }

  async requestWsTicket(): Promise<string> {
    const res = await firstValueFrom(
      this.http.post<WsTicketResponse>('/api/auth/ws-ticket', {}),
    );
    return res.ticket;
  }
}
