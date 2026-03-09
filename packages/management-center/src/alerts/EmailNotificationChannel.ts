/**
 * Email notification channel using nodemailer.
 *
 * Creates a reusable SMTP transport from ConfigService settings and
 * verifies the connection during module initialization in production.
 * Each send has a 10-second timeout to prevent indefinite hangs.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { ConfigService } from '../config/ConfigService.js';
import { NOTIFICATION_EMAIL_TIMEOUT_MS } from '../shared/constants.js';

@Injectable()
export class EmailNotificationChannel implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailNotificationChannel.name);
  private transport: Transporter<SMTPTransport.SentMessageInfo> | null = null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.from = configService.smtpFrom;
  }

  async onModuleInit(): Promise<void> {
    this.transport = createTransport({
      host: this.configService.smtpHost,
      port: this.configService.smtpPort,
      secure: this.configService.smtpSecure,
      auth: {
        user: this.configService.smtpUsername,
        pass: this.configService.smtpPassword,
      },
      connectionTimeout: NOTIFICATION_EMAIL_TIMEOUT_MS,
      greetingTimeout: NOTIFICATION_EMAIL_TIMEOUT_MS,
      socketTimeout: NOTIFICATION_EMAIL_TIMEOUT_MS,
    });

    // Verify transport in production to catch misconfigurations early
    if (process.env['NODE_ENV'] === 'production') {
      try {
        await this.transport.verify();
        this.logger.log('SMTP transport verified successfully');
      } catch (err) {
        this.logger.error(
          `SMTP transport verification failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Don't throw — the app can still start; emails will fail at send time
      }
    } else {
      this.logger.log(
        `SMTP transport configured (host=${this.configService.smtpHost}, port=${this.configService.smtpPort}), skipping verify in non-production`,
      );
    }
  }

  /**
   * Sends an email via the configured SMTP transport.
   * Throws on any failure (timeout, auth error, connection refused, etc.)
   * so the caller can handle retry logic.
   */
  async send(to: string[], subject: string, html: string, text: string): Promise<void> {
    if (!this.transport) {
      throw new Error('SMTP transport not initialized');
    }

    const result = await this.transport.sendMail({
      from: this.from,
      to: to.join(', '),
      subject,
      html,
      text,
    });

    this.logger.debug(`Email sent to ${to.join(', ')} — messageId=${result.messageId}`);
  }

  /** Closes the SMTP transport during module teardown. */
  close(): void {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
      this.logger.log('SMTP transport closed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.close();
  }
}
