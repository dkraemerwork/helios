/**
 * Dark theme configuration for the MC design system.
 * Centralises color tokens, spacing, and chart palettes
 * so components reference semantic names instead of hex literals.
 */

export const MC_COLORS = {
  bg: '#0a0e14',
  panel: 'rgba(14, 20, 30, 0.95)',
  panelSolid: '#0e141e',
  border: 'rgba(59, 130, 246, 0.15)',
  borderHover: 'rgba(59, 130, 246, 0.3)',
  blue: '#3b82f6',
  blueHover: '#2563eb',
  blueLight: '#60a5fa',
  amber: '#f59e0b',
  amberHover: '#d97706',
  emerald: '#10b981',
  emeraldHover: '#059669',
  red: '#ef4444',
  redHover: '#dc2626',
  cyan: '#06b6d4',
  cyanHover: '#0891b2',
  purple: '#a855f7',
  purpleHover: '#9333ea',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  textMuted: '#64748b',
} as const;

/** ECharts color palette for metric charts. */
export const CHART_PALETTE = [
  MC_COLORS.blue,
  MC_COLORS.emerald,
  MC_COLORS.amber,
  MC_COLORS.cyan,
  MC_COLORS.purple,
  MC_COLORS.red,
  '#f472b6',
  '#818cf8',
] as const;

/** Default ECharts theme overrides for the dark MC theme. */
export const ECHARTS_THEME = {
  backgroundColor: 'transparent',
  textStyle: {
    color: MC_COLORS.textDim,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 11,
  },
  title: {
    textStyle: { color: MC_COLORS.text, fontSize: 14, fontWeight: 500 },
  },
  legend: {
    textStyle: { color: MC_COLORS.textDim },
  },
  tooltip: {
    backgroundColor: MC_COLORS.panelSolid,
    borderColor: MC_COLORS.border,
    textStyle: { color: MC_COLORS.text, fontSize: 12 },
  },
  xAxis: {
    axisLine: { lineStyle: { color: MC_COLORS.border } },
    splitLine: { lineStyle: { color: MC_COLORS.border, type: 'dashed' as const } },
    axisLabel: { color: MC_COLORS.textMuted },
  },
  yAxis: {
    axisLine: { lineStyle: { color: MC_COLORS.border } },
    splitLine: { lineStyle: { color: MC_COLORS.border, type: 'dashed' as const } },
    axisLabel: { color: MC_COLORS.textMuted },
  },
  grid: {
    left: 48,
    right: 16,
    top: 32,
    bottom: 32,
    containLabel: false,
  },
  color: [...CHART_PALETTE],
} as const;

/** Severity-to-color mapping for alert displays. */
export const SEVERITY_COLORS: Record<string, string> = {
  warning: MC_COLORS.amber,
  critical: MC_COLORS.red,
};

/** Cluster state to color mapping. */
export const CLUSTER_STATE_COLORS: Record<string, string> = {
  ACTIVE: MC_COLORS.emerald,
  PASSIVE: MC_COLORS.amber,
  FROZEN: MC_COLORS.cyan,
  UNKNOWN: MC_COLORS.textMuted,
};
