/**
 * Default alert notification templates for email and webhook channels.
 *
 * All templates use {{alert.*}} placeholders that are interpolated at
 * delivery time via renderTemplate(). Templates are designed to be
 * readable in both HTML and plain-text contexts.
 */

/** Email subject line when an alert fires. */
export function alertFiredEmailSubject(): string {
  return '[{{alert.severity}}] {{alert.name}} fired on {{alert.clusterId}}';
}

/** Email body (HTML + text) when an alert fires. */
export function alertFiredEmailBody(): { html: string; text: string } {
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: {{alert.severity}} === 'critical' ? '#dc2626' : '#f59e0b'; padding: 12px 16px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0; color: #fff; font-size: 18px;">Alert Fired: {{alert.name}}</h2>
  </div>
  <div style="border: 1px solid #e5e7eb; border-top: none; padding: 16px; border-radius: 0 0 8px 8px;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 6px 8px; color: #6b7280; width: 140px;">Severity</td><td style="padding: 6px 8px; font-weight: 600;">{{alert.severity}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Cluster</td><td style="padding: 6px 8px;">{{alert.clusterId}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Member</td><td style="padding: 6px 8px;">{{alert.memberAddr}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Metric</td><td style="padding: 6px 8px;">{{alert.metric}} {{alert.operator}} {{alert.threshold}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Current Value</td><td style="padding: 6px 8px; font-weight: 600;">{{alert.metricValue}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Scope</td><td style="padding: 6px 8px;">{{alert.scope}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Fired At</td><td style="padding: 6px 8px;">{{alert.firedAtIso}}</td></tr>
    </table>
    <p style="margin: 16px 0 8px; color: #374151;">{{alert.message}}</p>
    <p style="margin: 8px 0 0; font-size: 13px; color: #9ca3af;">Runbook: {{alert.runbookUrl}}</p>
  </div>
</div>`.trim();

  const text = `ALERT FIRED: {{alert.name}}
Severity: {{alert.severity}}
Cluster: {{alert.clusterId}}
Member: {{alert.memberAddr}}
Metric: {{alert.metric}} {{alert.operator}} {{alert.threshold}}
Current Value: {{alert.metricValue}}
Scope: {{alert.scope}}
Fired At: {{alert.firedAtIso}}

{{alert.message}}

Runbook: {{alert.runbookUrl}}`;

  return { html, text };
}

/** Email subject line when an alert resolves. */
export function alertResolvedEmailSubject(): string {
  return '[RESOLVED] {{alert.name}} on {{alert.clusterId}}';
}

/** Email body (HTML + text) when an alert resolves. */
export function alertResolvedEmailBody(): { html: string; text: string } {
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #16a34a; padding: 12px 16px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0; color: #fff; font-size: 18px;">Alert Resolved: {{alert.name}}</h2>
  </div>
  <div style="border: 1px solid #e5e7eb; border-top: none; padding: 16px; border-radius: 0 0 8px 8px;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 6px 8px; color: #6b7280; width: 140px;">Cluster</td><td style="padding: 6px 8px;">{{alert.clusterId}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Member</td><td style="padding: 6px 8px;">{{alert.memberAddr}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Metric</td><td style="padding: 6px 8px;">{{alert.metric}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Fired At</td><td style="padding: 6px 8px;">{{alert.firedAtIso}}</td></tr>
      <tr><td style="padding: 6px 8px; color: #6b7280;">Resolved At</td><td style="padding: 6px 8px;">{{alert.resolvedAtIso}}</td></tr>
    </table>
    <p style="margin: 16px 0 0; color: #374151;">{{alert.message}}</p>
  </div>
</div>`.trim();

  const text = `ALERT RESOLVED: {{alert.name}}
Cluster: {{alert.clusterId}}
Member: {{alert.memberAddr}}
Metric: {{alert.metric}}
Fired At: {{alert.firedAtIso}}
Resolved At: {{alert.resolvedAtIso}}

{{alert.message}}`;

  return { html, text };
}

/** Webhook JSON body when an alert fires. */
export function alertFiredWebhookBody(): string {
  return JSON.stringify({
    event: 'alert.fired',
    alert: {
      id: '{{alert.id}}',
      name: '{{alert.name}}',
      severity: '{{alert.severity}}',
      clusterId: '{{alert.clusterId}}',
      memberAddr: '{{alert.memberAddr}}',
      metric: '{{alert.metric}}',
      metricValue: '{{alert.metricValue}}',
      threshold: '{{alert.threshold}}',
      operator: '{{alert.operator}}',
      scope: '{{alert.scope}}',
      firedAt: '{{alert.firedAtIso}}',
      message: '{{alert.message}}',
      runbookUrl: '{{alert.runbookUrl}}',
    },
  });
}

/** Webhook JSON body when an alert resolves. */
export function alertResolvedWebhookBody(): string {
  return JSON.stringify({
    event: 'alert.resolved',
    alert: {
      id: '{{alert.id}}',
      name: '{{alert.name}}',
      clusterId: '{{alert.clusterId}}',
      memberAddr: '{{alert.memberAddr}}',
      metric: '{{alert.metric}}',
      firedAt: '{{alert.firedAtIso}}',
      resolvedAt: '{{alert.resolvedAtIso}}',
      message: '{{alert.message}}',
    },
  });
}
