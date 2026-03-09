import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'mc-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-mc-bg px-4">
      <div class="w-full max-w-md mc-panel p-8">
        <h1 class="text-xl font-semibold text-mc-text mb-2">Reset Password</h1>
        <p class="text-sm text-mc-text-dim mb-6">
          Enter your email address and we'll send you a password reset link.
        </p>

        @if (sent()) {
          <div class="p-4 rounded-md bg-mc-emerald/10 border border-mc-emerald/20 text-mc-emerald text-sm">
            If an account exists with that email, a reset link has been sent.
            Please check your inbox.
          </div>
        } @else {
          @if (error()) {
            <div class="mb-4 p-3 rounded-md bg-mc-red/10 border border-mc-red/20 text-mc-red text-sm">
              {{ error() }}
            </div>
          }

          <form (ngSubmit)="onSubmit()" class="space-y-4">
            <div>
              <label for="email" class="block text-sm font-medium text-mc-text-dim mb-1.5">Email</label>
              <input
                id="email"
                type="email"
                [(ngModel)]="email"
                name="email"
                class="mc-input"
                placeholder="admin@example.com"
                autocomplete="email"
                required />
            </div>

            <button
              type="submit"
              class="mc-btn mc-btn-primary w-full py-2.5"
              [disabled]="loading()">
              @if (loading()) {
                Sending...
              } @else {
                Send Reset Link
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
export class ForgotPasswordComponent {
  private readonly authService = inject(AuthService);

  email = '';
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly sent = signal(false);

  async onSubmit(): Promise<void> {
    if (!this.email) {
      this.error.set('Please enter your email address.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.forgotPassword(this.email);
      this.sent.set(true);
    } catch {
      // Uniform response to prevent account enumeration
      this.sent.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
