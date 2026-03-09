/**
 * Formatting and template rendering utilities for the Helios Management Center.
 *
 * Handles alert template interpolation, human-readable byte/duration/percent
 * formatting, and pagination clamping.
 */

/**
 * Replaces `{{variable}}` placeholders in a template string with values from the
 * provided context map.
 *
 * Unmatched placeholders are left intact so downstream consumers can detect
 * missing bindings.
 */
export function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)}}/g, (_match, key: string) => {
    const trimmed = key.trim();
    return trimmed in context ? context[trimmed]! : `{{${trimmed}}}`;
  });
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** Formats a byte count into a human-readable string (e.g. `1.23 GB`). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const sign = bytes < 0 ? '-' : '';
  let abs = Math.abs(bytes);
  let unitIndex = 0;

  while (abs >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    abs /= 1024;
    unitIndex++;
  }

  const formatted = unitIndex === 0
    ? abs.toString()
    : abs.toFixed(2).replace(/\.?0+$/, '');

  return `${sign}${formatted} ${BYTE_UNITS[unitIndex]}`;
}

/** Formats a millisecond duration into a human-readable string. */
export function formatDuration(ms: number): string {
  if (ms < 0) return `-${formatDuration(-ms)}`;
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;

  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;

  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

/** Formats a numeric value (0–100 range) as a percentage string. */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Clamps a requested page size to the configured maximum.
 *
 * Returns at least 1 to prevent zero-size queries.
 */
export function clampPageSize(requested: number, max: number): number {
  return Math.max(1, Math.min(Math.floor(requested), max));
}
