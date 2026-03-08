export function renderMonitorDashboard(): string {
  return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Helios Monitor</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0e14;
      --panel: rgba(14, 20, 30, 0.95);
      --panel-border: rgba(60, 80, 100, 0.3);
      --text: #d4dce4;
      --muted: #6a7a8a;
      --blue: #3b82f6;
      --amber: #f59e0b;
      --emerald: #10b981;
      --red: #ef4444;
      --cyan: #06b6d4;
      --purple: #a855f7;
      --grid-line: rgba(60, 80, 100, 0.18);
      --mono: "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 13px;
      line-height: 1.5;
      min-height: 100vh;
    }

    /* ─── Layout ──────────────────────────────────────────────── */

    .page {
      max-width: 1600px;
      margin: 0 auto;
      padding: 16px 20px 32px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* ─── Header ──────────────────────────────────────────────── */

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 16px;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      flex-wrap: wrap;
    }

    .header-left {
      display: flex;
      align-items: baseline;
      gap: 12px;
    }

    .instance-name {
      font-family: var(--mono);
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      letter-spacing: 0.02em;
    }

    .header-label {
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .header-subtitle {
      font-size: 11px;
      color: var(--muted);
      font-family: var(--mono);
      margin-top: 2px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .state-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 3px;
      font-size: 11px;
      font-family: var(--mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border: 1px solid var(--panel-border);
      background: rgba(255,255,255,0.04);
      color: var(--text);
    }

    .state-badge.ok { border-color: rgba(16,185,129,0.4); color: var(--emerald); }
    .state-badge.warn { border-color: rgba(245,158,11,0.4); color: var(--amber); }
    .state-badge.err { border-color: rgba(239,68,68,0.4); color: var(--red); }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .cluster-size-badge {
      padding: 3px 9px;
      border-radius: 3px;
      font-size: 11px;
      font-family: var(--mono);
      background: rgba(59,130,246,0.15);
      border: 1px solid rgba(59,130,246,0.35);
      color: var(--blue);
    }

    .conn-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
      transition: background 0.3s;
      flex-shrink: 0;
    }

    .conn-indicator.live { background: var(--emerald); box-shadow: 0 0 6px rgba(16,185,129,0.5); }
    .conn-indicator.err { background: var(--red); }

    /* ─── Node connection indicators ─────────────────────────── */

    .node-conn-indicators {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .node-conn-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-family: var(--mono);
      color: var(--muted);
    }

    .node-conn-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--muted);
      transition: background 0.3s, box-shadow 0.3s;
      flex-shrink: 0;
    }

    .node-conn-dot.live { background: var(--emerald); box-shadow: 0 0 5px rgba(16,185,129,0.5); }
    .node-conn-dot.err { background: var(--red); }

    .master-indicator {
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--amber);
      font-family: var(--mono);
    }

    /* ─── Node tabs ───────────────────────────────────────────── */

    .node-tabs {
      display: flex;
      gap: 2px;
      padding: 0 4px;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      overflow-x: auto;
    }

    .node-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      font-size: 11px;
      font-family: var(--mono);
      color: var(--muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      transition: color 0.2s, border-color 0.2s;
      user-select: none;
    }

    .node-tab:hover { color: var(--text); }

    .node-tab.active {
      color: var(--text);
      border-bottom-color: var(--blue);
    }

    .node-tab .tab-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--muted);
      transition: background 0.3s;
      flex-shrink: 0;
    }

    .node-tab .tab-dot.live { background: var(--emerald); }
    .node-tab .tab-dot.err { background: var(--red); }

    /* ─── Panel ───────────────────────────────────────────────── */

    .panel {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      overflow: hidden;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      border-bottom: 1px solid var(--panel-border);
      background: rgba(0,0,0,0.2);
    }

    .panel-title {
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 600;
    }

    .panel-meta {
      font-size: 10px;
      color: var(--muted);
      font-family: var(--mono);
    }

    /* ─── Tables ──────────────────────────────────────────────── */

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    th {
      padding: 7px 12px;
      text-align: left;
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 500;
      border-bottom: 1px solid var(--panel-border);
      white-space: nowrap;
    }

    td {
      padding: 7px 12px;
      border-bottom: 1px solid rgba(60,80,100,0.12);
      font-family: var(--mono);
      color: var(--text);
      white-space: nowrap;
    }

    tbody tr:last-child td { border-bottom: none; }

    tbody tr:hover td { background: rgba(255,255,255,0.025); }

    tbody tr.local-member td { background: rgba(16,185,129,0.04); }

    .master-badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 3px;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: rgba(245,158,11,0.2);
      border: 1px solid rgba(245,158,11,0.4);
      color: var(--amber);
      font-family: var(--mono);
    }

    .local-badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 3px;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: rgba(16,185,129,0.15);
      border: 1px solid rgba(16,185,129,0.35);
      color: var(--emerald);
      font-family: var(--mono);
    }

    .type-badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 3px;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-family: var(--mono);
      background: rgba(59,130,246,0.12);
      border: 1px solid rgba(59,130,246,0.25);
      color: var(--blue);
    }

    .type-badge.queue { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.25); color: var(--amber); }
    .type-badge.topic { background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.25); color: var(--emerald); }
    .type-badge.executor { background: rgba(6,182,212,0.12); border-color: rgba(6,182,212,0.25); color: var(--cyan); }

    .num { text-align: right; }

    /* ─── Charts grid ─────────────────────────────────────────── */

    .charts-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .chart-panel {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .chart-body {
      padding: 10px 12px 6px;
      flex: 1;
    }

    .chart-values {
      display: flex;
      gap: 16px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }

    .cv-item {
      display: flex;
      align-items: baseline;
      gap: 5px;
    }

    .cv-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .cv-label {
      font-size: 10px;
      color: var(--muted);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .cv-val {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 600;
    }

    .chart-legend {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-family: var(--mono);
      color: var(--muted);
    }

    .legend-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .chart-svg-wrap {
      position: relative;
    }

    .chart-svg-wrap svg {
      display: block;
      width: 100%;
      height: 160px;
      overflow: visible;
    }

    .y-label {
      font-family: var(--mono);
      font-size: 9px;
      fill: var(--muted);
    }

    /* ─── Stats grid ──────────────────────────────────────────── */

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 1px;
      background: var(--panel-border);
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      overflow: hidden;
    }

    .stat-cell {
      background: var(--panel);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .stat-label {
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 500;
    }

    .stat-value {
      font-family: var(--mono);
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
      line-height: 1.2;
    }

    .stat-value.blue { color: var(--blue); }
    .stat-value.amber { color: var(--amber); }
    .stat-value.emerald { color: var(--emerald); }
    .stat-value.red { color: var(--red); }
    .stat-value.cyan { color: var(--cyan); }

    .stat-unit {
      font-size: 10px;
      color: var(--muted);
    }

    /* ─── Stats comparison table (all-nodes view) ─────────────── */

    .stats-compare-wrap {
      overflow-x: auto;
      padding: 12px 14px;
    }

    .stats-compare {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .stats-compare th {
      padding: 6px 12px;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 500;
      border-bottom: 1px solid var(--panel-border);
      white-space: nowrap;
      text-align: left;
    }

    .stats-compare th.node-col {
      text-align: right;
    }

    .stats-compare td {
      padding: 6px 12px;
      border-bottom: 1px solid rgba(60,80,100,0.10);
      font-family: var(--mono);
      color: var(--text);
      white-space: nowrap;
    }

    .stats-compare td.metric-name {
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-family: var(--sans);
    }

    .stats-compare td.node-val {
      text-align: right;
    }

    .stats-compare tbody tr:last-child td { border-bottom: none; }
    .stats-compare tbody tr:hover td { background: rgba(255,255,255,0.02); }

    /* ─── Blitz panel ─────────────────────────────────────────── */

    .blitz-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      padding: 12px 14px;
    }

    .blitz-card {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .blitz-label {
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .blitz-value {
      font-family: var(--mono);
      font-size: 20px;
      font-weight: 600;
      color: var(--text);
    }

    #blitz-section { display: none; }

    /* ─── Empty / loading states ──────────────────────────────── */

    .empty-row td {
      color: var(--muted);
      font-style: italic;
      text-align: center;
      padding: 20px;
    }

    .loading-msg {
      padding: 20px 14px;
      color: var(--muted);
      font-size: 12px;
      font-family: var(--mono);
    }

    /* ─── Responsive ──────────────────────────────────────────── */

    @media (max-width: 1100px) {
      .charts-grid { grid-template-columns: 1fr 1fr; }
    }

    @media (max-width: 720px) {
      .charts-grid { grid-template-columns: 1fr; }
      .header { flex-direction: column; align-items: flex-start; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- ─── Header ─────────────────────────────────────────────── -->
  <header class="header">
    <div class="header-left">
      <div>
        <div class="header-label">Helios Monitor</div>
        <div class="instance-name" id="instance-name">connecting...</div>
        <div class="header-subtitle" id="nodes-subtitle"></div>
      </div>
    </div>
    <div class="header-right">
      <div class="node-conn-indicators" id="node-conn-indicators"></div>
      <span class="state-badge" id="node-state-badge"><span class="dot"></span><span id="node-state-text">—</span></span>
      <span class="state-badge" id="cluster-state-badge"><span class="dot"></span><span id="cluster-state-text">—</span></span>
      <span class="cluster-size-badge" id="cluster-size-badge">— members</span>
    </div>
  </header>

  <!-- ─── Node Tabs ───────────────────────────────────────────── -->
  <div class="node-tabs" id="node-tabs"></div>

  <!-- ─── Cluster Members ─────────────────────────────────────── -->
  <div class="panel">
    <div class="panel-head">
      <span class="panel-title">Cluster Members</span>
      <span class="panel-meta" id="partition-meta"></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Address</th>
            <th>Role</th>
            <th class="num">Primary Partitions</th>
            <th class="num">Backup Partitions</th>
          </tr>
        </thead>
        <tbody id="members-tbody">
          <tr class="empty-row"><td colspan="4">Waiting for data…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ─── Distributed Objects ────────────────────────────────── -->
  <div class="panel">
    <div class="panel-head">
      <span class="panel-title">Distributed Objects</span>
      <span class="panel-meta" id="objects-meta"></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Name</th>
          </tr>
        </thead>
        <tbody id="objects-tbody">
          <tr class="empty-row"><td colspan="2">Waiting for data…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ─── Time-series Charts ──────────────────────────────────── -->
  <div class="charts-grid">

    <!-- Chart A: Event Loop Latency -->
    <div class="chart-panel">
      <div class="panel-head">
        <span class="panel-title">Event Loop Latency</span>
        <span class="panel-meta">ms</span>
      </div>
      <div class="chart-body">
        <div id="chart-el-legend" class="chart-legend"></div>
        <div class="chart-values" id="chart-el-values">
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--blue)"></span>
            <span class="cv-label">p50</span>
            <span class="cv-val" id="el-p50-val" style="color:var(--blue)">—</span>
          </div>
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--amber)"></span>
            <span class="cv-label">p99</span>
            <span class="cv-val" id="el-p99-val" style="color:var(--amber)">—</span>
          </div>
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--red)"></span>
            <span class="cv-label">max</span>
            <span class="cv-val" id="el-max-val" style="color:var(--red)">—</span>
          </div>
        </div>
        <div class="chart-svg-wrap">
          <svg id="chart-el" viewBox="0 0 400 160" preserveAspectRatio="none">
            <g id="chart-el-grid"></g>
            <g id="chart-el-lines">
              <polyline id="el-p50-line" fill="none" stroke="var(--blue)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points=""/>
              <polyline id="el-p99-line" fill="none" stroke="var(--amber)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points=""/>
              <polyline id="el-max-line" fill="none" stroke="var(--red)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points=""/>
            </g>
            <text id="el-y-max" class="y-label" x="2" y="12" fill="var(--muted)"></text>
            <text id="el-y-min" class="y-label" x="2" y="155" fill="var(--muted)"></text>
          </svg>
        </div>
      </div>
    </div>

    <!-- Chart B: CPU & Memory -->
    <div class="chart-panel">
      <div class="panel-head">
        <span class="panel-title">CPU &amp; Memory</span>
        <span class="panel-meta">% / MB</span>
      </div>
      <div class="chart-body">
        <div id="chart-cpu-legend" class="chart-legend"></div>
        <div class="chart-values" id="chart-cpu-values">
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--amber)"></span>
            <span class="cv-label">CPU</span>
            <span class="cv-val" id="cpu-pct-val" style="color:var(--amber)">—</span>
          </div>
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--cyan)"></span>
            <span class="cv-label">Heap</span>
            <span class="cv-val" id="heap-used-val" style="color:var(--cyan)">—</span>
          </div>
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--muted)"></span>
            <span class="cv-label">RSS</span>
            <span class="cv-val" id="rss-val" style="color:var(--muted)">—</span>
          </div>
        </div>
        <div class="chart-svg-wrap">
          <svg id="chart-cpu" viewBox="0 0 400 160" preserveAspectRatio="none">
            <g id="chart-cpu-grid"></g>
            <g id="chart-cpu-lines">
              <polyline id="cpu-pct-line" fill="none" stroke="var(--amber)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points=""/>
              <polyline id="heap-used-line" fill="none" stroke="var(--cyan)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points=""/>
              <polyline id="rss-line" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.7" points=""/>
            </g>
            <text id="cpu-y-max" class="y-label" x="2" y="12" fill="var(--muted)"></text>
            <text id="cpu-y-min" class="y-label" x="2" y="155" fill="var(--muted)"></text>
          </svg>
        </div>
      </div>
    </div>

    <!-- Chart C: Heap / GC -->
    <div class="chart-panel">
      <div class="panel-head">
        <span class="panel-title">Heap / GC</span>
        <span class="panel-meta">MB</span>
      </div>
      <div class="chart-body">
        <div id="chart-gc-legend" class="chart-legend"></div>
        <div class="chart-values" id="chart-gc-values">
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--cyan)"></span>
            <span class="cv-label">Used</span>
            <span class="cv-val" id="gc-used-val" style="color:var(--cyan)">—</span>
          </div>
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--blue)"></span>
            <span class="cv-label">Total</span>
            <span class="cv-val" id="gc-total-val" style="color:var(--blue)">—</span>
          </div>
          <div class="cv-item">
            <span class="cv-dot" style="background:var(--muted)"></span>
            <span class="cv-label">Limit</span>
            <span class="cv-val" id="gc-limit-val" style="color:var(--muted)">—</span>
          </div>
        </div>
        <div class="chart-svg-wrap">
          <svg id="chart-gc" viewBox="0 0 400 160" preserveAspectRatio="none">
            <g id="chart-gc-grid"></g>
            <g id="chart-gc-lines">
              <polyline id="gc-used-line" fill="none" stroke="var(--cyan)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points=""/>
              <polyline id="gc-total-line" fill="none" stroke="var(--blue)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points=""/>
              <polyline id="gc-limit-line" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round" opacity="0.6" points=""/>
            </g>
            <text id="gc-y-max" class="y-label" x="2" y="12" fill="var(--muted)"></text>
            <text id="gc-y-min" class="y-label" x="2" y="155" fill="var(--muted)"></text>
          </svg>
        </div>
      </div>
    </div>

  </div>

  <!-- ─── Stats Grid ──────────────────────────────────────────── -->
  <div class="panel" id="stats-panel">
    <div class="panel-head">
      <span class="panel-title">Current Sample</span>
      <span class="panel-meta" id="sample-ts">—</span>
    </div>
    <div id="stats-container">
      <div class="stats-grid" id="stats-grid">
        <!-- EL -->
        <div class="stat-cell">
          <span class="stat-label">EL Mean</span>
          <span class="stat-value blue" id="s-el-mean">—</span>
          <span class="stat-unit">ms</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">EL p50</span>
          <span class="stat-value blue" id="s-el-p50">—</span>
          <span class="stat-unit">ms</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">EL p99</span>
          <span class="stat-value amber" id="s-el-p99">—</span>
          <span class="stat-unit">ms</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">EL Max</span>
          <span class="stat-value red" id="s-el-max">—</span>
          <span class="stat-unit">ms</span>
        </div>
        <!-- CPU -->
        <div class="stat-cell">
          <span class="stat-label">CPU %</span>
          <span class="stat-value amber" id="s-cpu-pct">—</span>
          <span class="stat-unit">percent</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">User µs</span>
          <span class="stat-value" id="s-cpu-user">—</span>
          <span class="stat-unit">µs</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">System µs</span>
          <span class="stat-value" id="s-cpu-sys">—</span>
          <span class="stat-unit">µs</span>
        </div>
        <!-- Memory -->
        <div class="stat-cell">
          <span class="stat-label">Heap Used</span>
          <span class="stat-value cyan" id="s-heap-used">—</span>
          <span class="stat-unit">MB</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Heap Total</span>
          <span class="stat-value cyan" id="s-heap-total">—</span>
          <span class="stat-unit">MB</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">RSS</span>
          <span class="stat-value" id="s-rss">—</span>
          <span class="stat-unit">MB</span>
        </div>
        <!-- Transport -->
        <div class="stat-cell">
          <span class="stat-label">Bytes Read</span>
          <span class="stat-value blue" id="s-bytes-read">—</span>
          <span class="stat-unit">bytes</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Bytes Written</span>
          <span class="stat-value blue" id="s-bytes-written">—</span>
          <span class="stat-unit">bytes</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Channels</span>
          <span class="stat-value" id="s-channels">—</span>
          <span class="stat-unit">open</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Peers</span>
          <span class="stat-value" id="s-peers">—</span>
          <span class="stat-unit">connected</span>
        </div>
        <!-- Threads -->
        <div class="stat-cell">
          <span class="stat-label">Scatter Active</span>
          <span class="stat-value emerald" id="s-scatter-active">—</span>
          <span class="stat-unit">threads</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Scatter Pool</span>
          <span class="stat-value" id="s-scatter-size">—</span>
          <span class="stat-unit">size</span>
        </div>
        <!-- Migration -->
        <div class="stat-cell">
          <span class="stat-label">Migration Queue</span>
          <span class="stat-value amber" id="s-migration-queue">—</span>
          <span class="stat-unit">pending</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Active Migrations</span>
          <span class="stat-value" id="s-migration-active">—</span>
          <span class="stat-unit">running</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Completed Migrations</span>
          <span class="stat-value emerald" id="s-migration-completed">—</span>
          <span class="stat-unit">total</span>
        </div>
        <!-- Operations -->
        <div class="stat-cell">
          <span class="stat-label">Op Queue Size</span>
          <span class="stat-value amber" id="s-op-queue">—</span>
          <span class="stat-unit">pending</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Op Running</span>
          <span class="stat-value cyan" id="s-op-running">—</span>
          <span class="stat-unit">in flight</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Op Completed</span>
          <span class="stat-value emerald" id="s-op-completed">—</span>
          <span class="stat-unit">total</span>
        </div>
        <!-- Invocations -->
        <div class="stat-cell">
          <span class="stat-label">Pending Invocations</span>
          <span class="stat-value amber" id="s-inv-pending">—</span>
          <span class="stat-unit">active</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Invocation Capacity</span>
          <span class="stat-value" id="s-inv-pct">—</span>
          <span class="stat-unit">% used</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Inv Timeouts</span>
          <span class="stat-value red" id="s-inv-timeouts">—</span>
          <span class="stat-unit">failures</span>
        </div>
        <div class="stat-cell">
          <span class="stat-label">Inv Member Left</span>
          <span class="stat-value red" id="s-inv-memberleft">—</span>
          <span class="stat-unit">failures</span>
        </div>
        <!-- Job Lifecycle Counters (Hazelcast Jet MetricNames parity) -->
        <div class="stat-cell" id="s-jobs-section-submitted" style="display:none">
          <span class="stat-label">Jobs Submitted</span>
          <span class="stat-value blue" id="s-jobs-submitted">—</span>
          <span class="stat-unit">total</span>
        </div>
        <div class="stat-cell" id="s-jobs-section-started" style="display:none">
          <span class="stat-label">Executions Started</span>
          <span class="stat-value cyan" id="s-jobs-started">—</span>
          <span class="stat-unit">total</span>
        </div>
        <div class="stat-cell" id="s-jobs-section-success" style="display:none">
          <span class="stat-label">Jobs Succeeded</span>
          <span class="stat-value emerald" id="s-jobs-success">—</span>
          <span class="stat-unit">total</span>
        </div>
        <div class="stat-cell" id="s-jobs-section-failed" style="display:none">
          <span class="stat-label">Jobs Failed</span>
          <span class="stat-value red" id="s-jobs-failed">—</span>
          <span class="stat-unit">total</span>
        </div>
      </div>
    </div>
  </div>

  <!-- ─── Blitz Section ──────────────────────────────────────── -->
  <div class="panel" id="blitz-section">
    <div class="panel-head">
      <span class="panel-title">Blitz</span>
      <span class="panel-meta" id="blitz-state-meta">—</span>
    </div>
    <div class="blitz-grid">
      <div class="blitz-card">
        <span class="blitz-label">Cluster Size</span>
        <span class="blitz-value" id="blitz-cluster-size">—</span>
      </div>
      <div class="blitz-card">
        <span class="blitz-label">Readiness</span>
        <span class="blitz-value" id="blitz-readiness">—</span>
      </div>
      <div class="blitz-card">
        <span class="blitz-label">Running Pipelines</span>
        <span class="blitz-value" id="blitz-pipelines">—</span>
      </div>
      <div class="blitz-card">
        <span class="blitz-label">JetStream</span>
        <span class="blitz-value" id="blitz-jetstream">—</span>
      </div>
    </div>
  </div>

</div>

<script>
  'use strict';

  // ─── Chart constants ────────────────────────────────────────────
  const W = 400;
  const H = 160;
  const PAD_L = 34;
  const PAD_R = 8;
  const PAD_T = 14;
  const PAD_B = 14;
  const MAX_SAMPLES = 150;
  const NS = 'http://www.w3.org/2000/svg';

  // ─── Node color palette ─────────────────────────────────────────
  const NODE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#a855f7', '#06b6d4'];

  // ─── Multi-node state ───────────────────────────────────────────
  // nodeUrl -> { samples: [], payload: null, es: null, color: string, connected: bool, instanceName: string }
  const nodes = new Map();
  let activeTab = 'all';
  let nodeUrls = [];

  // ─── DOM helpers ────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  // ─── Number formatting ──────────────────────────────────────────
  function fmt(n, decimals) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(decimals === undefined ? 2 : decimals);
  }

  function fmtMB(bytes) {
    if (bytes == null) return '—';
    return fmt(bytes / 1048576, 1);
  }

  function fmtNum(n) {
    if (n == null) return '—';
    return new Intl.NumberFormat().format(n);
  }

  // ─── Escape HTML ────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Node URL parsing ───────────────────────────────────────────
  function parseNodeUrls() {
    const params = new URLSearchParams(window.location.search);
    const nodesParam = params.get('nodes');
    if (!nodesParam) {
      return [window.location.origin];
    }
    return nodesParam.split(',').map(function(n) {
      n = n.trim();
      if (/^\d+$/.test(n)) {
        return window.location.protocol + '//' + window.location.hostname + ':' + n;
      }
      return n;
    });
  }

  // ─── Node label (short display name) ────────────────────────────
  function nodeLabel(nodeUrl, state) {
    if (state && state.instanceName) return state.instanceName;
    try {
      const u = new URL(nodeUrl);
      return u.host;
    } catch (e) {
      return nodeUrl;
    }
  }

  // ─── SVG polyline builder ───────────────────────────────────────
  function buildPolyline(values, yMin, yMax) {
    if (!values.length) return '';
    const range = yMax - yMin || 1;
    return values.map(function(v, i) {
      const x = PAD_L + (i / Math.max(values.length - 1, 1)) * (W - PAD_L - PAD_R);
      const y = H - PAD_B - ((v - yMin) / range) * (H - PAD_T - PAD_B);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
  }

  function dataRange(seriesArray) {
    let min = Infinity;
    let max = -Infinity;
    for (let s = 0; s < seriesArray.length; s++) {
      const arr = seriesArray[s];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] != null && !isNaN(arr[i])) {
          if (arr[i] < min) min = arr[i];
          if (arr[i] > max) max = arr[i];
        }
      }
    }
    if (!isFinite(min)) { min = 0; max = 1; }
    if (min === max) { min = Math.max(0, min - 1); max = max + 1; }
    return { min: min, max: max };
  }

  function drawGrid(groupId, yMin, yMax) {
    const g = el(groupId);
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const y = PAD_T + (i / steps) * (H - PAD_T - PAD_B);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', PAD_L);
      line.setAttribute('x2', W - PAD_R);
      line.setAttribute('y1', y.toFixed(1));
      line.setAttribute('y2', y.toFixed(1));
      line.setAttribute('stroke', 'rgba(60,80,100,0.18)');
      line.setAttribute('stroke-width', '1');
      g.appendChild(line);
    }

    const yRange = yMax - yMin || 1;
    for (let i = 0; i <= steps; i++) {
      const value = yMax - (i / steps) * yRange;
      const y = PAD_T + (i / steps) * (H - PAD_T - PAD_B);
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', (PAD_L - 3).toString());
      text.setAttribute('y', (y + 3).toFixed(1));
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('font-size', '8');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('fill', 'rgba(106,122,138,0.8)');
      text.textContent = value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value.toFixed(value < 10 ? 1 : 0);
      g.appendChild(text);
    }
  }

  function updateLine(lineId, values, yMin, yMax) {
    const node = el(lineId);
    if (!node) return;
    node.setAttribute('points', buildPolyline(values, yMin, yMax));
  }

  // ─── Create SVG polyline element ────────────────────────────────
  function makeSvgLine(color, dashArray) {
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', color);
    pl.setAttribute('stroke-width', '1.5');
    pl.setAttribute('stroke-linejoin', 'round');
    pl.setAttribute('stroke-linecap', 'round');
    if (dashArray) pl.setAttribute('stroke-dasharray', dashArray);
    pl.setAttribute('points', '');
    return pl;
  }

  // ─── Clear multi-node overlay lines ─────────────────────────────
  function clearOverlayLines(linesGroupId) {
    const g = el(linesGroupId);
    if (!g) return;
    // Remove only dynamically created overlay lines (those with data-overlay attr)
    const toRemove = g.querySelectorAll('[data-overlay]');
    toRemove.forEach(function(n) { n.parentNode.removeChild(n); });
  }

  // ─── Chart legend rendering ─────────────────────────────────────
  function renderLegend(legendId, items) {
    const legendEl = el(legendId);
    if (!legendEl) return;
    legendEl.innerHTML = items.map(function(item) {
      return '<span class="legend-item">'
        + '<span class="legend-dot" style="background:' + escHtml(item.color) + '"></span>'
        + '<span>' + escHtml(item.label) + '</span>'
        + '</span>';
    }).join('');
  }

  // ─── Single-node chart rendering ────────────────────────────────
  function renderChartsForNode(samples) {
    if (!samples.length) return;

    // Restore original single-node static polylines
    const elLines = el('chart-el-lines');
    const cpuLines = el('chart-cpu-lines');
    const gcLines = el('chart-gc-lines');

    // Chart A: Event Loop
    const p50s = samples.map(function(s) { return s.eventLoop.p50Ms; });
    const p99s = samples.map(function(s) { return s.eventLoop.p99Ms; });
    const maxs = samples.map(function(s) { return s.eventLoop.maxMs; });
    const elRange = dataRange([p50s, p99s, maxs]);
    drawGrid('chart-el-grid', elRange.min, elRange.max);
    updateLine('el-p50-line', p50s, elRange.min, elRange.max);
    updateLine('el-p99-line', p99s, elRange.min, elRange.max);
    updateLine('el-max-line', maxs, elRange.min, elRange.max);

    const latest = samples[samples.length - 1];
    setText('el-p50-val', fmt(latest.eventLoop.p50Ms) + ' ms');
    setText('el-p99-val', fmt(latest.eventLoop.p99Ms) + ' ms');
    setText('el-max-val', fmt(latest.eventLoop.maxMs) + ' ms');

    // Chart B: CPU & Memory
    const cpuPcts = samples.map(function(s) { return s.cpu.percentUsed; });
    const heapUseds = samples.map(function(s) { return s.memory.heapUsed / 1048576; });
    const rssMBs = samples.map(function(s) { return s.memory.rss / 1048576; });
    const cpuRange = dataRange([cpuPcts, heapUseds, rssMBs]);
    drawGrid('chart-cpu-grid', cpuRange.min, cpuRange.max);
    updateLine('cpu-pct-line', cpuPcts, cpuRange.min, cpuRange.max);
    updateLine('heap-used-line', heapUseds, cpuRange.min, cpuRange.max);
    updateLine('rss-line', rssMBs, cpuRange.min, cpuRange.max);

    setText('cpu-pct-val', fmt(latest.cpu.percentUsed, 1) + '%');
    setText('heap-used-val', fmtMB(latest.memory.heapUsed) + ' MB');
    setText('rss-val', fmtMB(latest.memory.rss) + ' MB');

    // Chart C: Heap / GC
    const gcUseds = samples.map(function(s) { return s.gc ? s.gc.usedHeapSize / 1048576 : s.memory.heapUsed / 1048576; });
    const gcTotals = samples.map(function(s) { return s.gc ? s.gc.totalHeapSize / 1048576 : s.memory.heapTotal / 1048576; });
    const gcLimits = samples.map(function(s) { return s.gc ? s.gc.heapSizeLimit / 1048576 : 0; });
    const gcRange = dataRange([gcUseds, gcTotals, gcLimits]);
    drawGrid('chart-gc-grid', gcRange.min, gcRange.max);
    updateLine('gc-used-line', gcUseds, gcRange.min, gcRange.max);
    updateLine('gc-total-line', gcTotals, gcRange.min, gcRange.max);
    updateLine('gc-limit-line', gcLimits, gcRange.min, gcRange.max);

    const gcLatest = latest.gc;
    if (gcLatest) {
      setText('gc-used-val', fmtMB(gcLatest.usedHeapSize) + ' MB');
      setText('gc-total-val', fmtMB(gcLatest.totalHeapSize) + ' MB');
      setText('gc-limit-val', fmtMB(gcLatest.heapSizeLimit) + ' MB');
    } else {
      setText('gc-used-val', fmtMB(latest.memory.heapUsed) + ' MB');
      setText('gc-total-val', fmtMB(latest.memory.heapTotal) + ' MB');
      setText('gc-limit-val', '—');
    }
  }

  // ─── All-nodes overlay chart rendering ──────────────────────────
  function renderChartsAllNodes() {
    const connectedNodes = nodeUrls.filter(function(url) {
      const state = nodes.get(url);
      return state && state.samples && state.samples.length > 0;
    });

    if (!connectedNodes.length) return;

    // Build legend items
    const legendItems = connectedNodes.map(function(url) {
      const state = nodes.get(url);
      return { color: state.color, label: nodeLabel(url, state) };
    });

    // Show legends, hide single-node value rows
    const elValuesEl = el('chart-el-values');
    const cpuValuesEl = el('chart-cpu-values');
    const gcValuesEl = el('chart-gc-values');
    if (elValuesEl) elValuesEl.style.display = 'none';
    if (cpuValuesEl) cpuValuesEl.style.display = 'none';
    if (gcValuesEl) gcValuesEl.style.display = 'none';

    renderLegend('chart-el-legend', legendItems.map(function(i) { return { color: i.color, label: i.label + ' p99' }; }));
    renderLegend('chart-cpu-legend', legendItems.map(function(i) { return { color: i.color, label: i.label + ' cpu%' }; }));
    renderLegend('chart-gc-legend', legendItems.map(function(i) { return { color: i.color, label: i.label + ' heap' }; }));

    // Clear overlay lines from previous render
    clearOverlayLines('chart-el-lines');
    clearOverlayLines('chart-cpu-lines');
    clearOverlayLines('chart-gc-lines');

    // Hide static single-node lines
    ['el-p50-line', 'el-p99-line', 'el-max-line'].forEach(function(id) {
      const node = el(id);
      if (node) node.setAttribute('points', '');
    });
    ['cpu-pct-line', 'heap-used-line', 'rss-line'].forEach(function(id) {
      const node = el(id);
      if (node) node.setAttribute('points', '');
    });
    ['gc-used-line', 'gc-total-line', 'gc-limit-line'].forEach(function(id) {
      const node = el(id);
      if (node) node.setAttribute('points', '');
    });

    // Collect all series for range calculation
    const allElSeries = [];
    const allCpuSeries = [];
    const allGcSeries = [];

    connectedNodes.forEach(function(url) {
      const state = nodes.get(url);
      const s = state.samples;
      allElSeries.push(s.map(function(x) { return x.eventLoop.p99Ms; }));
      allCpuSeries.push(s.map(function(x) { return x.cpu.percentUsed; }));
      allGcSeries.push(s.map(function(x) { return x.gc ? x.gc.usedHeapSize / 1048576 : x.memory.heapUsed / 1048576; }));
    });

    const elRange = dataRange(allElSeries);
    const cpuRange = dataRange(allCpuSeries);
    const gcRange = dataRange(allGcSeries);

    drawGrid('chart-el-grid', elRange.min, elRange.max);
    drawGrid('chart-cpu-grid', cpuRange.min, cpuRange.max);
    drawGrid('chart-gc-grid', gcRange.min, gcRange.max);

    const elLinesG = el('chart-el-lines');
    const cpuLinesG = el('chart-cpu-lines');
    const gcLinesG = el('chart-gc-lines');

    connectedNodes.forEach(function(url) {
      const state = nodes.get(url);
      const s = state.samples;
      const color = state.color;

      // EL p99 line
      if (elLinesG) {
        const p99s = s.map(function(x) { return x.eventLoop.p99Ms; });
        const line = makeSvgLine(color, null);
        line.setAttribute('data-overlay', '1');
        line.setAttribute('points', buildPolyline(p99s, elRange.min, elRange.max));
        elLinesG.appendChild(line);
      }

      // CPU line
      if (cpuLinesG) {
        const cpus = s.map(function(x) { return x.cpu.percentUsed; });
        const line = makeSvgLine(color, null);
        line.setAttribute('data-overlay', '1');
        line.setAttribute('points', buildPolyline(cpus, cpuRange.min, cpuRange.max));
        cpuLinesG.appendChild(line);
      }

      // Heap used line
      if (gcLinesG) {
        const heaps = s.map(function(x) { return x.gc ? x.gc.usedHeapSize / 1048576 : x.memory.heapUsed / 1048576; });
        const line = makeSvgLine(color, null);
        line.setAttribute('data-overlay', '1');
        line.setAttribute('points', buildPolyline(heaps, gcRange.min, gcRange.max));
        gcLinesG.appendChild(line);
      }
    });
  }

  // ─── Restore single-node chart value rows ───────────────────────
  function showSingleNodeChartValues() {
    const elValuesEl = el('chart-el-values');
    const cpuValuesEl = el('chart-cpu-values');
    const gcValuesEl = el('chart-gc-values');
    if (elValuesEl) elValuesEl.style.display = '';
    if (cpuValuesEl) cpuValuesEl.style.display = '';
    if (gcValuesEl) gcValuesEl.style.display = '';

    // Clear legends
    const elLegend = el('chart-el-legend');
    const cpuLegend = el('chart-cpu-legend');
    const gcLegend = el('chart-gc-legend');
    if (elLegend) elLegend.innerHTML = '';
    if (cpuLegend) cpuLegend.innerHTML = '';
    if (gcLegend) gcLegend.innerHTML = '';

    // Clear overlay lines
    clearOverlayLines('chart-el-lines');
    clearOverlayLines('chart-cpu-lines');
    clearOverlayLines('chart-gc-lines');
  }

  // ─── Stats grid update (single node) ────────────────────────────
  function renderSample(s) {
    const ts = new Date(s.timestamp);
    setText('sample-ts', ts.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));

    setText('s-el-mean', fmt(s.eventLoop.meanMs));
    setText('s-el-p50', fmt(s.eventLoop.p50Ms));
    setText('s-el-p99', fmt(s.eventLoop.p99Ms));
    setText('s-el-max', fmt(s.eventLoop.maxMs));

    setText('s-cpu-pct', fmt(s.cpu.percentUsed, 1));
    setText('s-cpu-user', fmtNum(s.cpu.userUs));
    setText('s-cpu-sys', fmtNum(s.cpu.systemUs));

    setText('s-heap-used', fmtMB(s.memory.heapUsed));
    setText('s-heap-total', fmtMB(s.memory.heapTotal));
    setText('s-rss', fmtMB(s.memory.rss));

    setText('s-bytes-read', fmtNum(s.transport.bytesRead));
    setText('s-bytes-written', fmtNum(s.transport.bytesWritten));
    setText('s-channels', String(s.transport.openChannels));
    setText('s-peers', String(s.transport.peerCount));

    setText('s-scatter-active', String(s.threads.scatterPoolActive));
    setText('s-scatter-size', String(s.threads.scatterPoolSize));

    if (s.migration) {
      setText('s-migration-queue', fmtNum(s.migration.migrationQueueSize));
      setText('s-migration-active', String(s.migration.activeMigrations));
      setText('s-migration-completed', fmtNum(s.migration.completedMigrations));
    }

    if (s.operation) {
      setText('s-op-queue', fmtNum(s.operation.queueSize));
      setText('s-op-running', String(s.operation.runningCount));
      setText('s-op-completed', fmtNum(s.operation.completedCount));
    }

    if (s.invocation) {
      setText('s-inv-pending', fmtNum(s.invocation.pendingCount));
      setText('s-inv-pct', fmt(s.invocation.usedPercentage, 2));
      setText('s-inv-timeouts', fmtNum(s.invocation.timeoutFailures));
      setText('s-inv-memberleft', fmtNum(s.invocation.memberLeftFailures));
      // Mirror Hazelcast HealthMonitor warning thresholds visually
      const invPctEl = el('s-inv-pct');
      const invPendingEl = el('s-inv-pending');
      const isWarn = s.invocation.usedPercentage > 70 || s.invocation.pendingCount > 1000;
      if (invPctEl) invPctEl.className = 'stat-value' + (isWarn ? ' red' : ' emerald');
      if (invPendingEl) invPendingEl.className = 'stat-value' + (isWarn ? ' red' : ' amber');
    }

    if (s.blitz) {
      const section = el('blitz-section');
      if (section) section.style.display = '';
      setText('blitz-cluster-size', String(s.blitz.clusterSize));
      setText('blitz-readiness', s.blitz.readinessState);
      setText('blitz-pipelines', String(s.blitz.runningPipelines));
      setText('blitz-jetstream', s.blitz.jetStreamReady ? 'Ready' : 'Not ready');
      setText('blitz-state-meta', s.blitz.isReady ? 'ready' : 'not ready');

      // Job lifecycle counters — show cells only when job coordinator is active
      const jc = s.blitz.jobCounters;
      const jobCellIds = ['s-jobs-section-submitted', 's-jobs-section-started', 's-jobs-section-success', 's-jobs-section-failed'];
      jobCellIds.forEach(function(id) {
        const node = el(id);
        if (node) node.style.display = jc ? '' : 'none';
      });
      if (jc) {
        setText('s-jobs-submitted', fmtNum(jc.submitted));
        setText('s-jobs-started', fmtNum(jc.executionStarted));
        setText('s-jobs-success', fmtNum(jc.completedSuccessfully));
        setText('s-jobs-failed', fmtNum(jc.completedWithFailure));
      }
    }
  }

  // ─── Stats comparison table (all-nodes view) ────────────────────
  function renderStatsCompare() {
    const connectedNodes = nodeUrls.filter(function(url) {
      const state = nodes.get(url);
      return state && state.samples && state.samples.length > 0;
    });

    const container = el('stats-container');
    if (!container) return;

    if (!connectedNodes.length) {
      container.innerHTML = '<div class="loading-msg">Waiting for node data…</div>';
      return;
    }

    const metrics = [
      { label: 'EL Mean', unit: 'ms', getValue: function(s) { return fmt(s.eventLoop.meanMs); } },
      { label: 'EL p50', unit: 'ms', getValue: function(s) { return fmt(s.eventLoop.p50Ms); } },
      { label: 'EL p99', unit: 'ms', getValue: function(s) { return fmt(s.eventLoop.p99Ms); } },
      { label: 'EL Max', unit: 'ms', getValue: function(s) { return fmt(s.eventLoop.maxMs); } },
      { label: 'CPU %', unit: '%', getValue: function(s) { return fmt(s.cpu.percentUsed, 1); } },
      { label: 'Heap Used', unit: 'MB', getValue: function(s) { return fmtMB(s.memory.heapUsed); } },
      { label: 'Heap Total', unit: 'MB', getValue: function(s) { return fmtMB(s.memory.heapTotal); } },
      { label: 'RSS', unit: 'MB', getValue: function(s) { return fmtMB(s.memory.rss); } },
      { label: 'Bytes Read', unit: '', getValue: function(s) { return fmtNum(s.transport.bytesRead); } },
      { label: 'Bytes Written', unit: '', getValue: function(s) { return fmtNum(s.transport.bytesWritten); } },
      { label: 'Channels', unit: '', getValue: function(s) { return String(s.transport.openChannels); } },
      { label: 'Peers', unit: '', getValue: function(s) { return String(s.transport.peerCount); } },
      { label: 'Scatter Active', unit: '', getValue: function(s) { return String(s.threads.scatterPoolActive); } },
      { label: 'Scatter Pool', unit: '', getValue: function(s) { return String(s.threads.scatterPoolSize); } },
      { label: 'Migration Queue', unit: '', getValue: function(s) { return s.migration ? fmtNum(s.migration.migrationQueueSize) : '—'; } },
      { label: 'Active Migrations', unit: '', getValue: function(s) { return s.migration ? String(s.migration.activeMigrations) : '—'; } },
      { label: 'Completed Migrations', unit: '', getValue: function(s) { return s.migration ? fmtNum(s.migration.completedMigrations) : '—'; } },
      { label: 'Op Queue Size', unit: '', getValue: function(s) { return s.operation ? fmtNum(s.operation.queueSize) : '—'; } },
      { label: 'Op Running', unit: '', getValue: function(s) { return s.operation ? String(s.operation.runningCount) : '—'; } },
      { label: 'Op Completed', unit: '', getValue: function(s) { return s.operation ? fmtNum(s.operation.completedCount) : '—'; } },
      { label: 'Pending Invocations', unit: '', getValue: function(s) { return s.invocation ? fmtNum(s.invocation.pendingCount) : '—'; } },
      { label: 'Invocation Capacity %', unit: '%', getValue: function(s) { return s.invocation ? fmt(s.invocation.usedPercentage, 2) : '—'; } },
      { label: 'Inv Timeouts', unit: '', getValue: function(s) { return s.invocation ? fmtNum(s.invocation.timeoutFailures) : '—'; } },
      { label: 'Inv Member Left', unit: '', getValue: function(s) { return s.invocation ? fmtNum(s.invocation.memberLeftFailures) : '—'; } },
      { label: 'Jobs Submitted', unit: '', getValue: function(s) { return s.blitz && s.blitz.jobCounters ? fmtNum(s.blitz.jobCounters.submitted) : '—'; } },
      { label: 'Executions Started', unit: '', getValue: function(s) { return s.blitz && s.blitz.jobCounters ? fmtNum(s.blitz.jobCounters.executionStarted) : '—'; } },
      { label: 'Jobs Succeeded', unit: '', getValue: function(s) { return s.blitz && s.blitz.jobCounters ? fmtNum(s.blitz.jobCounters.completedSuccessfully) : '—'; } },
      { label: 'Jobs Failed', unit: '', getValue: function(s) { return s.blitz && s.blitz.jobCounters ? fmtNum(s.blitz.jobCounters.completedWithFailure) : '—'; } },
    ];

    const nodeHeaders = connectedNodes.map(function(url) {
      const state = nodes.get(url);
      const label = nodeLabel(url, state);
      const color = state.color;
      return '<th class="node-col">'
        + '<span style="display:inline-flex;align-items:center;gap:5px;">'
        + '<span style="width:7px;height:7px;border-radius:50%;background:' + escHtml(color) + ';display:inline-block;"></span>'
        + escHtml(label)
        + '</span>'
        + '</th>';
    }).join('');

    const rows = metrics.map(function(metric) {
      const cells = connectedNodes.map(function(url) {
        const state = nodes.get(url);
        const latest = state.samples.length ? state.samples[state.samples.length - 1] : null;
        const value = latest ? metric.getValue(latest) : '—';
        const unit = metric.unit ? ' <span style="font-size:9px;color:var(--muted);">' + escHtml(metric.unit) + '</span>' : '';
        return '<td class="node-val">' + escHtml(value) + unit + '</td>';
      }).join('');

      return '<tr>'
        + '<td class="metric-name">' + escHtml(metric.label) + '</td>'
        + cells
        + '</tr>';
    }).join('');

    container.innerHTML = '<div class="stats-compare-wrap">'
      + '<table class="stats-compare">'
      + '<thead><tr><th>Metric</th>' + nodeHeaders + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>'
      + '</div>';
  }

  // ─── Header state class ─────────────────────────────────────────
  function stateClass(state) {
    if (!state) return '';
    const upper = state.toUpperCase();
    if (upper === 'ACTIVE' || upper === 'CONNECTED' || upper === 'SAFE') return 'ok';
    if (upper === 'PASSIVE' || upper === 'PAUSED') return 'warn';
    return '';
  }

  // ─── Header update ──────────────────────────────────────────────
  function renderHeader() {
    const connectedCount = nodeUrls.filter(function(url) {
      const state = nodes.get(url);
      return state && state.connected;
    }).length;

    const isMultiNode = nodeUrls.length > 1;

    if (isMultiNode) {
      setText('instance-name', 'Helios Monitor');
      setText('nodes-subtitle', nodeUrls.length + ' nodes monitored · ' + connectedCount + ' connected');
    } else {
      const firstUrl = nodeUrls[0];
      const firstState = firstUrl ? nodes.get(firstUrl) : null;
      const firstPayload = firstState && firstState.payload;
      setText('instance-name', (firstPayload && firstPayload.instanceName) || 'connecting...');
      setText('nodes-subtitle', '');
    }

    // Header badges — reflect active tab's node or first connected node
    let refPayload = null;
    if (activeTab !== 'all') {
      const tabState = nodes.get(activeTab);
      refPayload = tabState && tabState.payload;
    } else {
      // Pick first connected node's payload for cluster state display
      for (let i = 0; i < nodeUrls.length; i++) {
        const state = nodes.get(nodeUrls[i]);
        if (state && state.payload) { refPayload = state.payload; break; }
      }
    }

    if (refPayload) {
      const nodeEl = el('node-state-badge');
      const clusterEl = el('cluster-state-badge');
      if (nodeEl) {
        nodeEl.className = 'state-badge ' + stateClass(refPayload.nodeState);
        setText('node-state-text', refPayload.nodeState || '—');
      }
      if (clusterEl) {
        clusterEl.className = 'state-badge ' + stateClass(refPayload.clusterState);
        setText('cluster-state-text', refPayload.clusterState || '—');
      }
      const sizeBadge = el('cluster-size-badge');
      if (sizeBadge) {
        sizeBadge.textContent = refPayload.clusterSize + ' member' + (refPayload.clusterSize !== 1 ? 's' : '');
      }
      setText('partition-meta', refPayload.partitionCount + ' partitions · v' + (refPayload.memberVersion || '?'));
    }
  }

  // ─── Connection indicators in header ────────────────────────────
  function renderConnIndicators() {
    const container = el('node-conn-indicators');
    if (!container) return;

    const isMultiNode = nodeUrls.length > 1;
    if (!isMultiNode) {
      // Single-node: render old-style single dot
      const url = nodeUrls[0];
      const state = url ? nodes.get(url) : null;
      const connected = state && state.connected;
      container.innerHTML = '<span class="conn-indicator ' + (connected ? 'live' : 'err') + '" title="' + (connected ? 'Connected' : 'Disconnected') + '"></span>';
      return;
    }

    container.innerHTML = nodeUrls.map(function(url) {
      const state = nodes.get(url);
      const connected = state && state.connected;
      const label = nodeLabel(url, state);
      const payload = state && state.payload;
      const isMaster = payload && payload.members && payload.members.some(function(m) { return m.isMaster && m.isLocal; });
      const masterHtml = isMaster ? ' <span class="master-indicator">★</span>' : '';
      const dotClass = 'node-conn-dot' + (state ? (connected ? ' live' : ' err') : '');
      return '<span class="node-conn-item">'
        + '<span class="' + dotClass + '" style="background:' + escHtml(state ? state.color : '#6a7a8a') + ';' + (connected ? 'box-shadow:0 0 5px ' + escHtml(state ? state.color : '#6a7a8a') + '66' : '') + '"></span>'
        + escHtml(label)
        + masterHtml
        + '</span>';
    }).join('');
  }

  // ─── Node tabs ──────────────────────────────────────────────────
  function renderTabs() {
    const tabsEl = el('node-tabs');
    if (!tabsEl) return;

    if (nodeUrls.length <= 1) {
      tabsEl.style.display = 'none';
      return;
    }

    tabsEl.style.display = '';

    const tabs = [{ id: 'all', label: 'All Nodes', color: null }].concat(
      nodeUrls.map(function(url) {
        const state = nodes.get(url);
        return { id: url, label: nodeLabel(url, state), color: state ? state.color : '#6a7a8a', connected: state && state.connected };
      })
    );

    tabsEl.innerHTML = tabs.map(function(tab) {
      const isActive = activeTab === tab.id;
      const dotStyle = tab.color
        ? 'background:' + escHtml(tab.color) + ';'
        : 'background:var(--blue);';
      const dotClass = 'tab-dot' + (tab.connected === false ? ' err' : tab.connected === true ? ' live' : (tab.id === 'all' ? '' : ''));
      return '<div class="node-tab' + (isActive ? ' active' : '') + '" data-tab="' + escHtml(tab.id) + '">'
        + '<span class="' + dotClass + '" style="' + dotStyle + '"></span>'
        + escHtml(tab.label)
        + '</div>';
    }).join('');

    // Attach click handlers
    tabsEl.querySelectorAll('.node-tab').forEach(function(tabEl) {
      tabEl.addEventListener('click', function() {
        activeTab = tabEl.getAttribute('data-tab') || 'all';
        renderAll();
      });
    });
  }

  // ─── Members table ──────────────────────────────────────────────
  function renderMembers() {
    const tbody = el('members-tbody');
    if (!tbody) return;

    // Union of all nodes' member lists, deduplicated by uuid (fallback: address)
    const seen = new Map();
    nodeUrls.forEach(function(url) {
      const state = nodes.get(url);
      const payload = state && state.payload;
      if (!payload || !payload.members) return;
      payload.members.forEach(function(m) {
        const key = m.uuid || m.address;
        if (!seen.has(key)) {
          seen.set(key, m);
        } else {
          // Merge: if this node considers member local, update the entry
          if (m.isLocal) seen.set(key, Object.assign({}, seen.get(key), { isLocal: true }));
          if (m.isMaster) seen.set(key, Object.assign({}, seen.get(key), { isMaster: true }));
        }
      });
    });

    const members = Array.from(seen.values());

    if (!members.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No members</td></tr>';
      return;
    }

    tbody.innerHTML = members.map(function(m) {
      const badges = [];
      if (m.isMaster) badges.push('<span class="master-badge">master</span>');
      if (m.isLocal) badges.push('<span class="local-badge">local</span>');
      const roleCells = badges.join(' ') || '<span style="color:var(--muted)">member</span>';
      const rowClass = m.isLocal ? ' class="local-member"' : '';
      return '<tr' + rowClass + '>'
        + '<td>' + escHtml(m.address) + '</td>'
        + '<td>' + roleCells + '</td>'
        + '<td class="num">' + m.primaryPartitions + '</td>'
        + '<td class="num">' + m.backupPartitions + '</td>'
        + '</tr>';
    }).join('');
  }

  // ─── Objects table ──────────────────────────────────────────────
  function renderObjects() {
    const tbody = el('objects-tbody');
    if (!tbody) return;

    // Union of all nodes' objects, deduplicated by type+name
    const seen = new Set();
    const rows = [];

    nodeUrls.forEach(function(url) {
      const state = nodes.get(url);
      const payload = state && state.payload;
      if (!payload || !payload.objects) return;
      const objects = payload.objects;

      function addRows(list, type, cls) {
        if (!list) return;
        list.forEach(function(name) {
          const key = type + ':' + name;
          if (!seen.has(key)) {
            seen.add(key);
            rows.push({ type: type, cls: cls, name: name });
          }
        });
      }

      addRows(objects.maps, 'Map', 'map');
      addRows(objects.queues, 'Queue', 'queue');
      addRows(objects.topics, 'Topic', 'topic');
      addRows(objects.executors, 'Executor', 'executor');
    });

    const objectsMeta = el('objects-meta');
    if (objectsMeta) {
      objectsMeta.textContent = rows.length + ' object' + (rows.length !== 1 ? 's' : '');
    }

    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="2">No distributed objects visible</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function(row) {
      return '<tr>'
        + '<td><span class="type-badge ' + row.cls + '">' + row.type + '</span></td>'
        + '<td>' + escHtml(row.name) + '</td>'
        + '</tr>';
    }).join('');
  }

  // ─── Full render ─────────────────────────────────────────────────
  function renderAll() {
    renderHeader();
    renderConnIndicators();
    renderTabs();
    renderMembers();
    renderObjects();

    if (activeTab === 'all' && nodeUrls.length > 1) {
      // Multi-node all view
      renderChartsAllNodes();
      renderStatsCompare();

      // Hide blitz (aggregate doesn't make sense)
      const blitz = el('blitz-section');
      if (blitz) blitz.style.display = 'none';

      setText('sample-ts', '—');
    } else {
      // Single node view (or single-node mode)
      showSingleNodeChartValues();

      const url = activeTab === 'all' ? nodeUrls[0] : activeTab;
      const state = url ? nodes.get(url) : null;
      const samples = state ? state.samples : [];
      const payload = state ? state.payload : null;

      if (samples.length) {
        renderChartsForNode(samples);
        renderSample(samples[samples.length - 1]);
      }

      // Restore single-node stats grid HTML if it was replaced by compare table
      const container = el('stats-container');
      if (container && !el('stats-grid')) {
        container.innerHTML = STATS_GRID_HTML;
        // Re-render sample into restored grid
        if (samples.length) renderSample(samples[samples.length - 1]);
      }
    }
  }

  // ─── SSE connection per node ─────────────────────────────────────
  function connectNode(nodeUrl, color) {
    const state = { samples: [], payload: null, es: null, color: color, connected: false, instanceName: '' };
    nodes.set(nodeUrl, state);

    // NOTE: Cross-origin SSE (different port, same host) requires the SSE
    // endpoint to respond with Access-Control-Allow-Origin: * headers.
    const es = new EventSource(nodeUrl + '/helios/monitor/stream');
    state.es = es;

    es.addEventListener('init', function(e) {
      state.connected = true;
      try {
        const payload = JSON.parse(e.data);
        state.payload = payload;
        state.instanceName = payload.instanceName || '';
        state.samples = Array.isArray(payload.samples) ? payload.samples.slice(-MAX_SAMPLES) : [];
        renderAll();
      } catch (err) {
        console.error('Monitor: failed to parse init payload from', nodeUrl, err);
      }
    });

    es.addEventListener('sample', function(e) {
      try {
        const sample = JSON.parse(e.data);
        state.samples.push(sample);
        if (state.samples.length > MAX_SAMPLES) state.samples.shift();
        renderAll();
      } catch (err) {
        console.error('Monitor: failed to parse sample from', nodeUrl, err);
      }
    });

    es.onerror = function() {
      state.connected = false;
      renderConnIndicators();
      renderTabs();
    };

    es.onopen = function() {
      state.connected = true;
      renderConnIndicators();
      renderTabs();
    };
  }

  // ─── Snapshot of single-node stats grid HTML ─────────────────────
  // Captured once so we can restore it after switching from compare view
  const STATS_GRID_HTML = (function() {
    const c = document.getElementById('stats-container');
    return c ? c.innerHTML : '';
  })();

  // ─── Bootstrap ───────────────────────────────────────────────────
  nodeUrls = parseNodeUrls();

  // Set initial subtitle
  if (nodeUrls.length > 1) {
    setText('nodes-subtitle', nodeUrls.length + ' nodes · connecting...');
  }

  nodeUrls.forEach(function(url, idx) {
    connectNode(url, NODE_COLORS[idx % NODE_COLORS.length]);
  });

  // Initial tab setup
  if (nodeUrls.length === 1) {
    activeTab = nodeUrls[0];
  }

  renderTabs();
</script>
</body>
</html>`;
}
