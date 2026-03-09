/**
 * Email template functions for authentication-related emails.
 *
 * Each template returns a structured object with subject, HTML body, and
 * plain text fallback. HTML uses inline styles for maximum email client
 * compatibility.
 */

import { Injectable } from '@nestjs/common';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class AuthMailTemplates {
  passwordResetEmail(resetUrl: string, displayName: string): EmailTemplate {
    const subject = 'Helios Management Center — Password Reset';

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 40px;">
              <h1 style="margin:0;color:#e94560;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Helios</h1>
              <p style="margin:4px 0 0;color:#8892a4;font-size:13px;">Management Center</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 24px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.5;">Hi ${escapeHtml(displayName)},</p>
              <p style="margin:0 0 24px;color:#4a4a68;font-size:15px;line-height:1.6;">
                We received a request to reset your password. Click the button below to choose a new password. This link expires in <strong>15 minutes</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="background-color:#e94560;border-radius:6px;">
                    <a href="${escapeHtml(resetUrl)}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                If you didn't request this, you can safely ignore this email. Your password will remain unchanged.
              </p>
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                If the button above doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin:0;color:#3b82f6;font-size:12px;word-break:break-all;line-height:1.4;">
                ${escapeHtml(resetUrl)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                Helios Management Center &mdash; Cluster Monitoring &amp; Administration
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const text = [
      `Hi ${displayName},`,
      '',
      'We received a request to reset your Helios Management Center password.',
      '',
      'Click the link below to choose a new password (expires in 15 minutes):',
      resetUrl,
      '',
      "If you didn't request this, you can safely ignore this email.",
      '',
      '— Helios Management Center',
    ].join('\n');

    return { subject, html, text };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
