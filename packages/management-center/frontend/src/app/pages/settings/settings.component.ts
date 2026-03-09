import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { ApiService, type SelfMetrics } from '../../core/services/api.service';

@Component({
  selector: 'mc-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="space-y-6 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Settings</h1>

      <!-- Current user info -->
      @if (authService.currentUser(); as user) {
        <div class="mc-panel p-4">
          <h2 class="text-sm font-semibold text-mc-text mb-3">Account</h2>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div class="text-mc-text-muted text-xs">Email</div>
              <div class="text-mc-text">{{ user.email }}</div>
            </div>
            <div>
              <div class="text-mc-text-muted text-xs">Display Name</div>
              <div class="text-mc-text">{{ user.displayName }}</div>
            </div>
            <div>
              <div class="text-mc-text-muted text-xs">Roles</div>
              <div class="text-mc-text">{{ user.roles.join(', ') }}</div>
            </div>
            <div>
              <div class="text-mc-text-muted text-xs">Cluster Scopes</div>
              <div class="text-mc-text">{{ user.clusterScopes.join(', ') || 'All clusters' }}</div>
            </div>
          </div>
        </div>
      }

      <!-- SMTP Test (admin only) -->
      @if (authService.hasRole('admin')) {
        <div class="mc-panel p-4">
          <h2 class="text-sm font-semibold text-mc-text mb-3">SMTP Test</h2>
          <div class="flex gap-3">
            <input
              type="email"
              [(ngModel)]="testEmail"
              class="mc-input max-w-xs"
              placeholder="Test email address" />
            <button
              class="mc-btn mc-btn-ghost text-xs"
              [disabled]="smtpLoading()"
              (click)="testSmtp()">
              {{ smtpLoading() ? 'Sending...' : 'Send Test Email' }}
            </button>
          </div>
          @if (smtpResult(); as result) {
            <div class="mt-2 text-xs"
              [class.text-mc-emerald]="result.success"
              [class.text-mc-red]="!result.success">
              {{ result.success ? 'Test email sent successfully' : result.error }}
            </div>
          }
        </div>
      }

      <!-- Self-metrics (admin only) -->
      @if (authService.hasRole('admin')) {
        <div class="mc-panel p-4">
          <h2 class="text-sm font-semibold text-mc-text mb-3">System Health</h2>
          @if (selfMetrics(); as m) {
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div class="text-mc-text-muted text-xs">CPU</div>
                <div class="text-mc-text">{{ m.processCpuPercent.toFixed(1) }}%</div>
              </div>
              <div>
                <div class="text-mc-text-muted text-xs">Memory</div>
                <div class="text-mc-text">{{ m.processMemoryMb.toFixed(0) }} MB</div>
              </div>
              <div>
                <div class="text-mc-text-muted text-xs">Active HTTP</div>
                <div class="text-mc-text">{{ m.activeHttpRequests }}</div>
              </div>
              <div>
                <div class="text-mc-text-muted text-xs">Active WS</div>
                <div class="text-mc-text">{{ m.activeWsSessions }}</div>
              </div>
              <div>
                <div class="text-mc-text-muted text-xs">Write Queue</div>
                <div class="text-mc-text">{{ m.asyncWriteQueueDepth }}</div>
              </div>
              <div>
                <div class="text-mc-text-muted text-xs">SSR Render</div>
                <div class="text-mc-text">{{ m.ssrRenderDurationMs.toFixed(0) }} ms</div>
              </div>
              <div>
                <div class="text-mc-text-muted text-xs">Notification Circuit</div>
                <div class="text-mc-text"
                  [class.text-mc-emerald]="m.circuitBreakerState === 'closed'"
                  [class.text-mc-red]="m.circuitBreakerState === 'open'"
                  [class.text-mc-amber]="m.circuitBreakerState === 'half_open'">
                  {{ m.circuitBreakerState }}
                </div>
              </div>
              <div>
                <div class="text-mc-text-muted text-xs">SSR Failures</div>
                <div class="text-mc-text">{{ m.ssrRenderFailures }}</div>
              </div>
            </div>
          } @else {
            <button class="mc-btn mc-btn-ghost text-xs" (click)="loadSelfMetrics()">Load System Metrics</button>
          }
        </div>
      }
    </div>
  `,
})
export class SettingsComponent {
  readonly authService = inject(AuthService);
  private readonly apiService = inject(ApiService);

  testEmail = '';
  readonly smtpLoading = signal(false);
  readonly smtpResult = signal<{ success: boolean; error?: string } | null>(null);
  readonly selfMetrics = signal<SelfMetrics | null>(null);

  async testSmtp(): Promise<void> {
    if (!this.testEmail) return;
    this.smtpLoading.set(true);
    this.smtpResult.set(null);
    try {
      const result = await this.apiService.testSmtp({ to: this.testEmail });
      this.smtpResult.set(result);
    } catch (err) {
      this.smtpResult.set({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      this.smtpLoading.set(false);
    }
  }

  async loadSelfMetrics(): Promise<void> {
    try {
      const metrics = await this.apiService.getSelfMetrics();
      this.selfMetrics.set(metrics);
    } catch { /* handled by interceptor */ }
  }
}
