import { Component, inject, signal, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'mc-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-mc-bg px-4">
      <div class="w-full max-w-md mc-panel p-8">
        <h1 class="text-xl font-semibold text-mc-text mb-2">Set New Password</h1>
        <p class="text-sm text-mc-text-dim mb-6">
          Enter your new password. Must be at least 14 characters with at least 1 letter and 1 number.
        </p>

        @if (success()) {
          <div class="p-4 rounded-md bg-mc-emerald/10 border border-mc-emerald/20 text-mc-emerald text-sm mb-4">
            Your password has been reset successfully. You can now sign in.
          </div>
          <a
            routerLink="/login"
            class="mc-btn mc-btn-primary w-full py-2.5 text-center block">
            Go to Login
          </a>
        } @else {
          @if (error()) {
            <div class="mb-4 p-3 rounded-md bg-mc-red/10 border border-mc-red/20 text-mc-red text-sm">
              {{ error() }}
            </div>
          }

          <form (ngSubmit)="onSubmit()" class="space-y-4">
            <div>
              <label for="password" class="block text-sm font-medium text-mc-text-dim mb-1.5">New Password</label>
              <input
                id="password"
                type="password"
                [(ngModel)]="newPassword"
                name="password"
                class="mc-input"
                placeholder="Minimum 14 characters"
                autocomplete="new-password"
                required
                minlength="14" />
            </div>

            <div>
              <label for="confirm" class="block text-sm font-medium text-mc-text-dim mb-1.5">Confirm Password</label>
              <input
                id="confirm"
                type="password"
                [(ngModel)]="confirmPassword"
                name="confirm"
                class="mc-input"
                placeholder="Confirm your password"
                autocomplete="new-password"
                required />
            </div>

            <button
              type="submit"
              class="mc-btn mc-btn-primary w-full py-2.5"
              [disabled]="loading()">
              @if (loading()) {
                Resetting...
              } @else {
                Reset Password
              }
            </button>
          </form>
        }

        <div class="mt-4 text-center">
          <a routerLink="/login" class="text-sm text-mc-blue hover:text-mc-blue-hover transition-colors">
            Back to login
          </a>
        </div>
      </div>
    </div>
  `,
})
export class ResetPasswordComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  newPassword = '';
  confirmPassword = '';
  private token = '';

  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly success = signal(false);

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      const params = new URLSearchParams(window.location.search);
      this.token = params.get('token') ?? '';

      if (!this.token) {
        this.error.set('Invalid or missing reset token. Please request a new password reset.');
      }
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.token) {
      this.error.set('Invalid or missing reset token.');
      return;
    }

    if (this.newPassword.length < 14) {
      this.error.set('Password must be at least 14 characters.');
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.error.set('Passwords do not match.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.resetPassword(this.token, this.newPassword);
      this.success.set(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Password reset failed. Please try again.';
      this.error.set(message);
    } finally {
      this.loading.set(false);
    }
  }
}
