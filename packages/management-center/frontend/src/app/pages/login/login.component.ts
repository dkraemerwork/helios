import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'mc-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-mc-bg px-4">
      <div class="w-full max-w-md mc-panel p-8">
        <!-- Logo -->
        <div class="flex items-center justify-center gap-3 mb-8">
          <div class="w-10 h-10 rounded-lg bg-mc-blue flex items-center justify-center">
            <span class="text-white font-bold text-lg">H</span>
          </div>
          <h1 class="text-xl font-semibold text-mc-text">Helios Management Center</h1>
        </div>

        <!-- Error -->
        @if (error()) {
          <div class="mb-4 p-3 rounded-md bg-mc-red/10 border border-mc-red/20 text-mc-red text-sm">
            {{ error() }}
          </div>
        }

        <!-- Form -->
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

          <div>
            <label for="password" class="block text-sm font-medium text-mc-text-dim mb-1.5">Password</label>
            <input
              id="password"
              type="password"
              [(ngModel)]="password"
              name="password"
              class="mc-input"
              placeholder="Enter your password"
              autocomplete="current-password"
              required />
          </div>

          <button
            type="submit"
            class="mc-btn mc-btn-primary w-full py-2.5"
            [disabled]="loading()">
            @if (loading()) {
              Signing in...
            } @else {
              Sign In
            }
          </button>
        </form>

        <!-- Forgot password link -->
        <div class="mt-4 text-center">
          <a
            routerLink="/forgot-password"
            class="text-sm text-mc-blue hover:text-mc-blue-hover transition-colors">
            Forgot your password?
          </a>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  async onSubmit(): Promise<void> {
    if (!this.email || !this.password) {
      this.error.set('Please enter your email and password.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.login(this.email, this.password);

      // Redirect to the return URL if present, otherwise to root
      const params = new URLSearchParams(window.location.search);
      const returnUrl = params.get('returnUrl');
      this.router.navigateByUrl(returnUrl ?? '/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      this.error.set(message);
    } finally {
      this.loading.set(false);
    }
  }
}
