import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Branded error page component for SSR failure and server error scenarios.
 *
 * Renders a clear, branded error message with guidance for the user.
 * Used as the SSR fallback when Angular rendering fails (section 6.0.2)
 * and as the catch-all error route (section 17.4).
 */
@Component({
  selector: 'mc-error-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="error-page">
      <div class="error-card">
        <div class="error-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 class="error-title">{{ title() }}</h1>
        <p class="error-message">{{ message() }}</p>
        @if (showRetry()) {
          <div class="error-actions">
            <button class="btn-primary" (click)="retry()">Try Again</button>
            <a class="btn-secondary" href="/login">Return to Login</a>
          </div>
        }
        <p class="error-footer">Helios Management Center</p>
      </div>
    </div>
  `,
  styles: [`
    .error-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f172a;
      color: #e2e8f0;
      padding: 1rem;
    }
    .error-card {
      max-width: 28rem;
      text-align: center;
      padding: 2.5rem;
      background: #1e293b;
      border-radius: 0.75rem;
      border: 1px solid #334155;
    }
    .error-icon {
      color: #f59e0b;
      margin-bottom: 1.5rem;
    }
    .error-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0 0 0.75rem;
      color: #f1f5f9;
    }
    .error-message {
      font-size: 0.9375rem;
      color: #94a3b8;
      line-height: 1.6;
      margin: 0 0 1.5rem;
    }
    .error-actions {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      margin-bottom: 1.5rem;
    }
    .btn-primary {
      background: #3b82f6;
      color: #fff;
      border: none;
      padding: 0.625rem 1.25rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
    }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary {
      color: #94a3b8;
      text-decoration: none;
      padding: 0.625rem 1.25rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      border: 1px solid #475569;
    }
    .btn-secondary:hover { color: #e2e8f0; border-color: #64748b; }
    .error-footer {
      font-size: 0.75rem;
      color: #475569;
      margin: 0;
    }
  `],
})
export class ErrorComponent {
  readonly title = input('Something went wrong');
  readonly message = input('An unexpected error occurred. Please try again or contact your administrator if the problem persists.');
  readonly showRetry = input(true);

  retry(): void {
    window.location.reload();
  }
}
