interface ClusterMemberView {
  uuid: string;
  address: string;
  localMember: boolean;
  version: string;
  isLiteMember: boolean;
  isMaster: boolean;
  primaryPartitions: number;
  backupPartitions: number;
  primaryMaps: number;
  backupMaps: number;
  primaryTopics: number;
  backupTopics: number;
  primaryQueues: number;
  backupQueues: number;
  primaryObjects: number;
  backupObjects: number;
}

interface TopicMessageView {
  topicName: string;
  payload: unknown;
  publishTime: number;
  publishingMemberId: string | null;
  receivedAt: number;
}

interface TopicSummaryView {
  topicName: string;
  messageCount: number;
  publishCount: number;
  receiveCount: number;
  lastMessage: TopicMessageView | null;
}

interface OverviewSampleView {
  timestamp: number;
  bytesRead: number;
  bytesWritten: number;
  topicPublishes: number;
  topicReceives: number;
  queueOffers: number;
  queuePolls: number;
  totalKnownObjects: number;
  totalBackupObjects: number;
}

interface ObjectInventoryView {
  maps: string[];
  queues: string[];
  topics: string[];
  executors: string[];
}

interface TopologySummaryView {
  memberCount: number;
  partitionCount: number;
  knownMaps: number;
  knownTopics: number;
  knownQueues: number;
  openChannels: number;
  peerCount: number;
  localPrimaryPartitions: number;
  localBackupPartitions: number;
}

interface MetricSummaryView {
  bytesRead: number;
  bytesWritten: number;
  topicPublishes: number;
  topicReceives: number;
  queueOffers: number;
  queuePolls: number;
  totalKnownObjects: number;
  totalBackupObjects: number;
}

export interface ManagementCenterPayload {
  nodeName: string;
  clusterId: string;
  restBaseUrl: string;
  controlBaseUrl: string;
  nodeState: string;
  clusterState: string;
  clusterSafe: boolean;
  memberVersion: string;
  masterAddress: string | null;
  topology: TopologySummaryView;
  metrics: MetricSummaryView;
  members: ClusterMemberView[];
  objectInventory: ObjectInventoryView;
  observedTopics: TopicSummaryView[];
  recentMessages: TopicMessageView[];
  samples: OverviewSampleView[];
}

export function renderManagementCenterPage(): string {
  return String.raw`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Helios Management Center</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #071118;
        --panel: rgba(12, 23, 34, 0.92);
        --panel-soft: rgba(16, 30, 43, 0.92);
        --line: rgba(141, 169, 190, 0.16);
        --line-strong: rgba(141, 169, 190, 0.24);
        --text: #edf4f8;
        --muted: #93a9b7;
        --accent: #f4a259;
        --accent-2: #63c5ff;
        --accent-3: #61d7a7;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Avenir Next", "Helvetica Neue", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(244, 162, 89, 0.1), transparent 24%),
          radial-gradient(circle at 85% 0%, rgba(99, 197, 255, 0.1), transparent 24%),
          linear-gradient(180deg, #050c12 0%, #071118 100%);
      }

      .page {
        max-width: 1460px;
        margin: 0 auto;
        padding: 28px;
      }

      .topbar,
      .hero,
      .panel,
      .stat-card,
      .member-card,
      .topic-card,
      .event-row,
      .inventory-card {
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: var(--shadow);
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 20px;
        padding: 20px 22px;
        border-radius: 22px;
      }

      .eyebrow,
      .label,
      th,
      .meta {
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .cluster-line {
        margin-top: 8px;
        color: #d6e3ea;
        font-size: 15px;
      }

      .title {
        margin: 6px 0 0;
        font-family: "Avenir Next Condensed", "Arial Narrow", sans-serif;
        font-size: 30px;
        line-height: 1;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .status-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
      }

      .status-chip {
        min-width: 140px;
        max-width: 260px;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.03);
      }

      .status-chip strong,
      .value,
      .mono,
      code {
        font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      }

      .chip-value {
        display: block;
        margin-top: 4px;
        color: var(--text);
        font-size: 14px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }

      .hero {
        margin-top: 18px;
        padding: 26px;
        border-radius: 28px;
        background:
          linear-gradient(135deg, rgba(244, 162, 89, 0.1), transparent 34%),
          linear-gradient(180deg, rgba(14, 27, 39, 0.98), rgba(9, 18, 27, 0.98));
      }

      .hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.8fr);
        gap: 18px;
      }

      .hero h1 {
        margin: 8px 0 0;
        font-family: "Avenir Next Condensed", "Arial Narrow", sans-serif;
        font-size: clamp(38px, 5vw, 64px);
        line-height: 0.94;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        max-width: 10ch;
      }

      .hero-copy {
        max-width: 60ch;
        margin-top: 14px;
        color: #d1e0e8;
        line-height: 1.6;
      }

      .pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }

      .pill {
        padding: 9px 12px;
        border-radius: 999px;
        border: 1px solid var(--line-strong);
        background: rgba(255, 255, 255, 0.04);
        color: #dce7ed;
        font-size: 12px;
      }

      .hero-side {
        display: grid;
        gap: 14px;
      }

      .stat-card,
      .inventory-card,
      .topic-card,
      .event-row,
      .member-card {
        border-radius: 20px;
        padding: 16px;
      }

      .hero-side .stat-card {
        min-height: 128px;
      }

      .metric-grid,
      .members-grid,
      .bottom-grid,
      .inventory-grid,
      .topic-grid,
      .events {
        display: grid;
        gap: 16px;
      }

      .metric-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-top: 18px;
      }

      .metric-value {
        display: block;
        margin-top: 8px;
        font-size: 30px;
        line-height: 1.05;
        font-weight: 700;
        color: var(--text);
      }

      .metric-note {
        margin-top: 6px;
        color: #d5e1e8;
        font-size: 13px;
        line-height: 1.5;
      }

      .panel {
        margin-top: 18px;
        padding: 22px;
        border-radius: 28px;
      }

      .panel-head {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 14px;
        margin-bottom: 16px;
      }

      .panel-title {
        margin: 6px 0 0;
        font-family: "Avenir Next Condensed", "Arial Narrow", sans-serif;
        font-size: 24px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .members-grid {
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      }

      .member-card {
        background: var(--panel-soft);
      }

      .member-name {
        margin-top: 6px;
        font-size: 20px;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }

      .member-meta {
        margin-top: 6px;
        color: #d3e0e8;
        font-size: 13px;
      }

      .member-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 14px;
      }

      .member-stats .value {
        display: block;
        margin-top: 4px;
        font-size: 22px;
        color: var(--text);
      }

      .chart {
        border: 1px solid var(--line);
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.03);
        padding: 14px;
      }

      .chart svg {
        width: 100%;
        height: 220px;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 10px;
        color: var(--muted);
        font-size: 12px;
      }

      .legend i {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 8px;
      }

      .table-wrap {
        overflow: auto;
        border-radius: 20px;
        border: 1px solid var(--line);
      }

      table {
        width: 100%;
        min-width: 920px;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 14px 16px;
        text-align: left;
        border-bottom: 1px solid var(--line);
      }

      tbody tr:hover {
        background: rgba(255, 255, 255, 0.03);
      }

      .role {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .role.master { background: rgba(244, 162, 89, 0.18); }
      .role.local { background: rgba(97, 215, 167, 0.18); }

      .bottom-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .inventory-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .inventory-card .value {
        display: block;
        margin-top: 6px;
        font-size: 26px;
      }

      .payload {
        margin-top: 12px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        color: #d6e6f1;
        font-family: "SFMono-Regular", Menlo, Consolas, monospace;
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }

      @media (max-width: 1180px) {
        .metric-grid,
        .bottom-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 980px) {
        .topbar,
        .hero-grid,
        .panel-head {
          flex-direction: column;
          align-items: start;
        }

        .hero-grid,
        .bottom-grid,
        .inventory-grid,
        .metric-grid {
          grid-template-columns: 1fr;
        }

        .status-row {
          justify-content: flex-start;
        }
      }

      @media (max-width: 640px) {
        .page,
        .topbar,
        .hero,
        .panel {
          padding: 18px;
        }

        .member-stats {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="topbar">
        <div>
          <div class="eyebrow">Helios management center</div>
          <div class="title">Enterprise Overview</div>
          <div class="cluster-line" id="banner">Loading cluster state</div>
        </div>
        <div class="status-row" id="toolbar"></div>
      </section>

      <section class="hero">
        <div class="hero-grid">
          <div>
            <div class="label">Front Page</div>
            <h1>Real topology and ownership telemetry.</h1>
            <div class="hero-copy">
              This dashboard shows only runtime-backed Helios values: cluster membership,
              partition placement, transport counters, queue and topic counters, and current
              primary versus backup object placement.
            </div>
            <div class="pill-row" id="hero-pills"></div>
          </div>
          <div class="hero-side">
            <div class="stat-card">
              <div class="label">Topology</div>
              <div class="metric-note" id="topology-copy">Waiting for topology snapshot.</div>
            </div>
            <div class="stat-card">
              <div class="label">Inventory</div>
              <div class="metric-note" id="inventory-copy">Waiting for object inventory.</div>
            </div>
          </div>
        </div>
      </section>

      <section class="metric-grid" id="metric-grid"></section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="label">Members</div>
            <div class="panel-title">Cluster Topology</div>
          </div>
          <div class="meta" id="topology-note">Awaiting membership view.</div>
        </div>
        <div class="members-grid" id="member-cards"></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="label">Transport</div>
            <div class="panel-title">Raw Cumulative Metrics</div>
          </div>
          <div class="meta">No derived rates or estimated load values.</div>
        </div>
        <div class="chart">
          <svg viewBox="0 0 920 220" preserveAspectRatio="none">
            <polyline id="bytes-read-line" fill="none" stroke="#63c5ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
            <polyline id="bytes-written-line" fill="none" stroke="#f4a259" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
            <polyline id="objects-line" fill="none" stroke="#61d7a7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
          </svg>
          <div class="legend">
            <span><i style="background:#63c5ff"></i>Total bytes read</span>
            <span><i style="background:#f4a259"></i>Total bytes written</span>
            <span><i style="background:#61d7a7"></i>Total visible queue objects</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="label">Ownership</div>
            <div class="panel-title">Member Object Placement</div>
          </div>
          <div class="meta">Primary and backup counts are current snapshots.</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Maps</th>
                <th>Topics</th>
                <th>Queues</th>
                <th>Primary Partitions</th>
                <th>Backup Partitions</th>
                <th>Primary Objects</th>
                <th>Backup Objects</th>
              </tr>
            </thead>
            <tbody id="member-table"></tbody>
          </table>
        </div>
      </section>

      <section class="bottom-grid">
        <section class="panel">
          <div class="panel-head">
            <div>
              <div class="label">Inventory</div>
              <div class="panel-title">Visible Objects</div>
            </div>
          </div>
          <div class="inventory-grid" id="inventory-grid"></div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <div class="label">Topics</div>
              <div class="panel-title">Observed Topic Counters</div>
            </div>
          </div>
          <div class="topic-grid" id="topic-grid"></div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <div class="label">Messages</div>
              <div class="panel-title">Recent Observed Payloads</div>
            </div>
          </div>
          <div class="events" id="events"></div>
        </section>
      </section>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);

      function formatNumber(value) {
        return new Intl.NumberFormat().format(value);
      }

      function formatPayload(value) {
        if (value === null || value === undefined) {
          return 'No payload captured';
        }
        try {
          return JSON.stringify(value, null, 2);
        } catch {
          return String(value);
        }
      }

      function buildLine(values, width, height) {
        if (values.length === 0) {
          return '';
        }
        const max = Math.max(...values, 1);
        return values.map((value, index) => {
          const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
          const y = height - ((value / max) * (height - 12)) - 6;
          return x.toFixed(2) + ',' + y.toFixed(2);
        }).join(' ');
      }

      function renderToolbar(payload) {
        const items = [
          { label: 'Cluster', value: payload.clusterId },
          { label: 'Master', value: payload.masterAddress || 'pending' },
          { label: 'Node', value: payload.nodeName },
          { label: 'Peers', value: payload.topology.peerCount + ' peers / ' + payload.topology.openChannels + ' channels' },
        ];

        $('toolbar').innerHTML = items.map((item) => {
          return '<div class="status-chip">'
            + '<div class="label">' + item.label + '</div>'
            + '<span class="chip-value">' + item.value + '</span>'
            + '</div>';
        }).join('');
      }

      function renderHero(payload) {
        $('banner').textContent = payload.topology.memberCount + ' members / '
          + payload.topology.partitionCount + ' partitions / '
          + payload.clusterState + ' / ' + payload.nodeState;

        $('hero-pills').innerHTML = [
          'master ' + (payload.masterAddress || 'pending'),
          'cluster safe ' + (payload.clusterSafe ? 'yes' : 'no'),
          'local primary partitions ' + payload.topology.localPrimaryPartitions,
          'local backup partitions ' + payload.topology.localBackupPartitions,
        ].map((text) => '<span class="pill">' + text + '</span>').join('');

        $('topology-copy').textContent = payload.topology.memberCount + ' members, '
          + payload.topology.partitionCount + ' partitions, '
          + payload.topology.peerCount + ' handshaken peers.';

        $('inventory-copy').textContent = payload.topology.knownMaps + ' maps, '
          + payload.topology.knownTopics + ' topics, '
          + payload.topology.knownQueues + ' queues visible from this node.';
      }

      function renderMetricGrid(payload) {
        const metrics = [
          { label: 'Bytes read', value: formatNumber(payload.metrics.bytesRead), note: 'Transport total' },
          { label: 'Bytes written', value: formatNumber(payload.metrics.bytesWritten), note: 'Transport total' },
          { label: 'Topic publishes', value: formatNumber(payload.metrics.topicPublishes), note: 'Observed topic counters' },
          { label: 'Topic receives', value: formatNumber(payload.metrics.topicReceives), note: 'Observed topic counters' },
          { label: 'Queue offers', value: formatNumber(payload.metrics.queueOffers), note: 'Queue operation counters' },
          { label: 'Queue polls', value: formatNumber(payload.metrics.queuePolls), note: 'Queue operation counters' },
          { label: 'Known objects', value: formatNumber(payload.metrics.totalKnownObjects), note: 'Primary queue item snapshot' },
          { label: 'Backup objects', value: formatNumber(payload.metrics.totalBackupObjects), note: 'Backup queue item snapshot' },
        ];

        $('metric-grid').innerHTML = metrics.map((metric) => {
          return '<article class="stat-card">'
            + '<div class="label">' + metric.label + '</div>'
            + '<span class="metric-value">' + metric.value + '</span>'
            + '<div class="metric-note">' + metric.note + '</div>'
            + '</article>';
        }).join('');
      }

      function renderMembers(payload) {
        $('topology-note').textContent = 'Master ' + (payload.masterAddress || 'pending')
          + ' - local ownership ' + payload.topology.localPrimaryPartitions + ' primary / '
          + payload.topology.localBackupPartitions + ' backup partitions';

        $('member-cards').innerHTML = payload.members.map((member) => {
          return '<article class="member-card">'
            + '<div class="label">' + (member.isMaster ? 'Master member' : 'Cluster member') + '</div>'
            + '<div class="member-name mono">' + member.address + '</div>'
            + '<div class="member-meta">' + member.uuid + ' - version ' + member.version + (member.localMember ? ' - local' : '') + '</div>'
            + '<div class="member-stats">'
            + '<div><div class="label">Primary partitions</div><span class="value">' + member.primaryPartitions + '</span></div>'
            + '<div><div class="label">Backup partitions</div><span class="value">' + member.backupPartitions + '</span></div>'
            + '<div><div class="label">Primary objects</div><span class="value">' + member.primaryObjects + '</span></div>'
            + '<div><div class="label">Backup objects</div><span class="value">' + member.backupObjects + '</span></div>'
            + '</div>'
            + '</article>';
        }).join('');
      }

      function renderChart(payload) {
        $('bytes-read-line').setAttribute('points', buildLine(payload.samples.map((sample) => sample.bytesRead), 920, 220));
        $('bytes-written-line').setAttribute('points', buildLine(payload.samples.map((sample) => sample.bytesWritten), 920, 220));
        $('objects-line').setAttribute('points', buildLine(payload.samples.map((sample) => sample.totalKnownObjects), 920, 220));
      }

      function renderTable(payload) {
        $('member-table').innerHTML = payload.members.map((member) => {
          let role = '<span class="role">member</span>';
          if (member.isMaster) {
            role = '<span class="role master">master</span>';
          } else if (member.localMember) {
            role = '<span class="role local">local</span>';
          }

          return '<tr>'
            + '<td><div class="mono">' + member.address + '</div><div>' + member.uuid + '</div></td>'
            + '<td>' + role + '</td>'
            + '<td>' + member.primaryMaps + ' / ' + member.backupMaps + '</td>'
            + '<td>' + member.primaryTopics + ' / ' + member.backupTopics + '</td>'
            + '<td>' + member.primaryQueues + ' / ' + member.backupQueues + '</td>'
            + '<td>' + member.primaryPartitions + '</td>'
            + '<td>' + member.backupPartitions + '</td>'
            + '<td>' + member.primaryObjects + '</td>'
            + '<td>' + member.backupObjects + '</td>'
            + '</tr>';
        }).join('');
      }

      function renderInventory(payload) {
        const items = [
          { label: 'Maps', value: payload.objectInventory.maps.length, detail: payload.objectInventory.maps.join(', ') || 'None visible' },
          { label: 'Topics', value: payload.objectInventory.topics.length, detail: payload.objectInventory.topics.join(', ') || 'None visible' },
          { label: 'Queues', value: payload.objectInventory.queues.length, detail: payload.objectInventory.queues.join(', ') || 'None visible' },
          { label: 'Executors', value: payload.objectInventory.executors.length, detail: payload.objectInventory.executors.join(', ') || 'None visible' },
        ];

        $('inventory-grid').innerHTML = items.map((item) => {
          return '<article class="inventory-card">'
            + '<div class="label">' + item.label + '</div>'
            + '<span class="value">' + item.value + '</span>'
            + '<div class="metric-note">' + item.detail + '</div>'
            + '</article>';
        }).join('');
      }

      function renderTopics(payload) {
        if (payload.observedTopics.length === 0) {
          $('topic-grid').innerHTML = '<article class="topic-card">No observed topics yet.</article>';
          return;
        }

        $('topic-grid').innerHTML = payload.observedTopics.map((topic) => {
          return '<article class="topic-card">'
            + '<div class="label">Observed topic</div>'
            + '<div class="member-name">' + topic.topicName + '</div>'
            + '<div class="metric-note">Messages ' + topic.messageCount + '</div>'
            + '<div class="metric-note">Publishes ' + topic.publishCount + ' / Receives ' + topic.receiveCount + '</div>'
            + '<div class="payload">' + formatPayload(topic.lastMessage ? topic.lastMessage.payload : null).replace(/</g, '&lt;') + '</div>'
            + '</article>';
        }).join('');
      }

      function renderEvents(payload) {
        if (payload.recentMessages.length === 0) {
          $('events').innerHTML = '<article class="event-row">No retained messages yet.</article>';
          return;
        }

        $('events').innerHTML = payload.recentMessages.map((message) => {
          return '<article class="event-row">'
            + '<div class="label">' + message.topicName + '</div>'
            + '<div class="metric-note">Publisher ' + (message.publishingMemberId || 'local') + '</div>'
            + '<div class="payload">' + formatPayload(message.payload).replace(/</g, '&lt;') + '</div>'
            + '</article>';
        }).join('');
      }

      function render(payload) {
        renderToolbar(payload);
        renderHero(payload);
        renderMetricGrid(payload);
        renderMembers(payload);
        renderChart(payload);
        renderTable(payload);
        renderInventory(payload);
        renderTopics(payload);
        renderEvents(payload);
      }

      async function refresh() {
        const response = await fetch('/demo/management-center/data', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Failed to load management center data');
        }
        render(await response.json());
      }

      refresh().catch((error) => {
        $('banner').textContent = error instanceof Error ? error.message : String(error);
      });
      setInterval(() => {
        refresh().catch(() => {});
      }, 2500);
    </script>
  </body>
</html>`;
}
