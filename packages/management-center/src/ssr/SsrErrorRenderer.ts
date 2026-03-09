/**
 * Renders branded error pages when Angular SSR fails or is unavailable.
 *
 * Produces complete self-contained HTML with inline dark-theme styling
 * consistent with the Helios Management Center visual identity. No
 * external dependencies or Angular runtime required — pure HTML/CSS
 * string output suitable for direct HTTP response.
 */

import { Injectable } from '@nestjs/common';

/** Maps common HTTP status codes to user-friendly titles. */
const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Authentication Required',
  403: 'Access Denied',
  404: 'Page Not Found',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

@Injectable()
export class SsrErrorRenderer {
  /**
   * Renders a complete HTML error page with professional dark-theme styling.
   *
   * @param statusCode - HTTP status code (e.g., 500)
   * @param message    - Human-readable error description
   * @param requestId  - Unique request identifier for support reference
   */
  renderErrorPage(statusCode: number, message: string, requestId: string): string {
    const title = STATUS_TITLES[statusCode] ?? 'Error';
    const escapedMessage = escapeHtml(message);
    const escapedRequestId = escapeHtml(requestId);
    const isClientError = statusCode >= 400 && statusCode < 500;

    const guidance = isClientError
      ? 'Check the URL and try again, or return to the dashboard.'
      : 'The server encountered an unexpected condition. Try refreshing the page or come back later.';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${statusCode} ${title} — Helios Management Center</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #0f1117;
      color: #e1e4e8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .error-container {
      max-width: 560px;
      width: 100%;
      text-align: center;
    }

    .logo {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 3rem;
    }

    .logo-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, #f97316, #fb923c);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .logo-icon svg {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: #fff;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .logo-text {
      font-size: 1.125rem;
      font-weight: 600;
      color: #f0f0f0;
      letter-spacing: -0.01em;
    }

    .status-code {
      font-size: 6rem;
      font-weight: 800;
      line-height: 1;
      background: linear-gradient(135deg, #f97316 0%, #ef4444 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 1rem;
    }

    .status-title {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f0f0f0;
      margin-bottom: 1rem;
    }

    .status-message {
      font-size: 1rem;
      color: #8b949e;
      line-height: 1.6;
      margin-bottom: 0.75rem;
    }

    .guidance {
      font-size: 0.875rem;
      color: #6e7681;
      line-height: 1.5;
      margin-bottom: 2rem;
    }

    .request-id {
      font-size: 0.75rem;
      color: #484f58;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      padding: 0.5rem 1rem;
      background: #161b22;
      border-radius: 6px;
      display: inline-block;
      margin-bottom: 2rem;
    }

    .actions {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      padding: 0.625rem 1.25rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      transition: background-color 0.15s ease, transform 0.1s ease;
      cursor: pointer;
      border: none;
    }

    .btn:active { transform: scale(0.97); }

    .btn-primary {
      background: #f97316;
      color: #fff;
    }

    .btn-primary:hover { background: #ea580c; }

    .btn-secondary {
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
    }

    .btn-secondary:hover { background: #30363d; }

    @media (max-width: 480px) {
      .status-code { font-size: 4rem; }
      .status-title { font-size: 1.25rem; }
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      </div>
      <span class="logo-text">Helios Management Center</span>
    </div>

    <div class="status-code">${statusCode}</div>
    <h1 class="status-title">${title}</h1>
    <p class="status-message">${escapedMessage}</p>
    <p class="guidance">${guidance}</p>

    <div class="request-id">Request ID: ${escapedRequestId}</div>

    <div class="actions">
      <a href="/" class="btn btn-primary">Back to Dashboard</a>
      <button class="btn btn-secondary" onclick="location.reload()">Retry</button>
    </div>
  </div>
</body>
</html>`;
  }
}

/**
 * Escapes HTML special characters to prevent XSS in error messages.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
