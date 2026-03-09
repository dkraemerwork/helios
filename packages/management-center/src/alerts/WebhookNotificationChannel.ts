/**
 * Webhook notification channel using the native fetch API.
 *
 * Sends HTTP requests to configured webhook URLs with a 5-second
 * timeout enforced via AbortController. Non-2xx responses are treated
 * as failures, with up to 1KB of the response body captured for
 * diagnostic logging.
 */

import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_WEBHOOK_TIMEOUT_MS } from '../shared/constants.js';

@Injectable()
export class WebhookNotificationChannel {
  private readonly logger = new Logger(WebhookNotificationChannel.name);

  /**
   * Sends a webhook notification.
   *
   * @throws Error on timeout, network failure, or non-2xx response.
   */
  async send(
    url: string,
    method: 'POST' | 'PUT',
    headers: Record<string, string>,
    body: string,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NOTIFICATION_WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        // Capture a snippet of the response body for error diagnostics
        let bodySnippet = '';
        try {
          const rawBody = await response.text();
          bodySnippet = rawBody.slice(0, 1024);
        } catch {
          bodySnippet = '<unable to read response body>';
        }

        throw new Error(
          `Webhook returned HTTP ${response.status} ${response.statusText}: ${bodySnippet}`,
        );
      }

      this.logger.debug(`Webhook delivered to ${url} — ${response.status}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Webhook timed out after ${NOTIFICATION_WEBHOOK_TIMEOUT_MS}ms: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
