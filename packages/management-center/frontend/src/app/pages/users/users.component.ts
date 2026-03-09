import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService, type McUserAdmin } from '../../core/services/api.service';
import { SsrStateService } from '../../core/services/ssr-state.service';

@Component({
  selector: 'mc-users',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="space-y-4 animate-fade-in">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold text-mc-text">Users</h1>
        <button class="mc-btn mc-btn-primary text-xs" (click)="showCreateDialog()">
          Create User
        </button>
      </div>

      <div class="mc-panel">
        <table class="mc-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Display Name</th>
              <th>Roles</th>
              <th>Status</th>
              <th>Cluster Scopes</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (user of users(); track user.id) {
              <tr>
                <td class="text-sm">{{ user.email }}</td>
                <td class="text-sm">{{ user.displayName }}</td>
                <td>
                  @for (role of user.roles; track role) {
                    <span class="mc-badge mc-badge-blue mr-1 text-xs">{{ role }}</span>
                  }
                </td>
                <td>
                  <span class="mc-badge"
                    [class.mc-badge-emerald]="user.status === 'active'"
                    [class.mc-badge-red]="user.status === 'disabled'">
                    {{ user.status }}
                  </span>
                </td>
                <td class="text-xs text-mc-text-dim">{{ user.clusterScopes.join(', ') || '*' }}</td>
                <td class="text-xs text-mc-text-dim">{{ user.createdAt | date:'mediumDate' }}</td>
                <td>
                  <div class="flex gap-2">
                    <button
                      class="mc-btn mc-btn-ghost text-xs py-1 px-2"
                      (click)="resetPassword(user.id)">
                      Reset Password
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="text-center text-mc-text-muted py-8">No users found</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      @if (total() > pageSize) {
        <div class="flex justify-center gap-2">
          <button
            class="mc-btn mc-btn-ghost text-xs"
            [disabled]="currentPage() <= 1"
            (click)="loadPage(currentPage() - 1)">
            Previous
          </button>
          <span class="text-xs text-mc-text-dim py-2">
            Page {{ currentPage() }} of {{ totalPages() }}
          </span>
          <button
            class="mc-btn mc-btn-ghost text-xs"
            [disabled]="currentPage() >= totalPages()"
            (click)="loadPage(currentPage() + 1)">
            Next
          </button>
        </div>
      }
    </div>
  `,
})
export class UsersComponent implements OnInit {
  private readonly apiService = inject(ApiService);
  private readonly ssrState = inject(SsrStateService);

  readonly users = signal<McUserAdmin[]>([]);
  readonly total = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = 20;
  readonly totalPages = signal(1);

  async ngOnInit(): Promise<void> {
    const ssrUsers = this.ssrState.getStateKey<McUserAdmin[]>('users');
    const ssrCount = this.ssrState.getStateKey<number>('userCount');

    if (ssrUsers) {
      this.users.set(ssrUsers);
      this.total.set(ssrCount ?? ssrUsers.length);
      this.totalPages.set(Math.ceil((ssrCount ?? ssrUsers.length) / this.pageSize));
      return;
    }

    await this.loadPage(1);
  }

  async loadPage(page: number): Promise<void> {
    try {
      const result = await this.apiService.getUsers(page, this.pageSize);
      this.users.set(result.items);
      this.total.set(result.total);
      this.currentPage.set(page);
      this.totalPages.set(Math.ceil(result.total / this.pageSize));
    } catch { /* handled by interceptor */ }
  }

  async resetPassword(userId: string): Promise<void> {
    if (!confirm('Are you sure you want to reset this user\'s password?')) return;
    try {
      await this.apiService.resetUserPassword(userId);
    } catch { /* handled by interceptor */ }
  }

  showCreateDialog(): void {
    // Full modal implementation will be added with forms/dialog infrastructure
    alert('Create user dialog will be implemented with the forms infrastructure.');
  }
}
