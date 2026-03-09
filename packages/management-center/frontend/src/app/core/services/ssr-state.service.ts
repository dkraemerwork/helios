import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';

const TRANSFER_STATE_ID = 'mc-transfer-state';

/**
 * Service for reading SSR transfer state injected by the backend.
 * The backend serializes initial route data as a JSON script block
 * with id="mc-transfer-state". This service reads and parses it once
 * on the client to prevent duplicate API calls after hydration.
 */
@Injectable({ providedIn: 'root' })
export class SsrStateService {
  private readonly platformId = inject(PLATFORM_ID);
  private transferState: Record<string, unknown> | null = null;
  private consumed = false;

  /** Whether we are running on the server. */
  readonly isServer = signal(isPlatformServer(this.platformId));

  /** Whether we are running in the browser. */
  readonly isBrowser = signal(isPlatformBrowser(this.platformId));

  /**
   * Returns the full transfer state object from SSR.
   * Returns null if already consumed or running on the server.
   * The state is consumed on first read to prevent stale reuse.
   */
  getTransferState<T = Record<string, unknown>>(): T | null {
    if (this.consumed) return null;
    if (!isPlatformBrowser(this.platformId)) return null;

    if (this.transferState === null) {
      this.transferState = this.readTransferStateFromDom();
    }

    if (this.transferState === null) return null;

    this.consumed = true;
    return this.transferState as T;
  }

  /**
   * Returns a specific key from the transfer state without consuming the entire state.
   */
  getStateKey<T>(key: string): T | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    if (this.transferState === null) {
      this.transferState = this.readTransferStateFromDom();
    }

    if (this.transferState === null) return null;

    const value = this.transferState[key];
    return value !== undefined ? (value as T) : null;
  }

  /**
   * Marks the transfer state as fully consumed, preventing further reads.
   */
  markConsumed(): void {
    this.consumed = true;
  }

  /**
   * Whether the transfer state has valid data that hasn't been consumed yet.
   */
  hasUnconsumedState(): boolean {
    if (this.consumed) return false;
    if (!isPlatformBrowser(this.platformId)) return false;

    if (this.transferState === null) {
      this.transferState = this.readTransferStateFromDom();
    }

    return this.transferState !== null;
  }

  private readTransferStateFromDom(): Record<string, unknown> | null {
    try {
      const el = document.getElementById(TRANSFER_STATE_ID);
      if (!el?.textContent) return null;

      const parsed = JSON.parse(el.textContent) as Record<string, unknown>;
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
}
