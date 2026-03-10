import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { ClusterStore } from '../../core/store/cluster.store';
import { WebSocketService } from '../../core/services/websocket.service';

@Component({
  selector: 'mc-members',
  standalone: true,
  imports: [RouterLink, DecimalPipe],
  template: `
    <div class="space-y-4 animate-fade-in">
      <h1 class="text-xl font-semibold text-mc-text">Members</h1>

      <div class="mc-panel">
        <table class="mc-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Version</th>
              <th>Status</th>
              <th>CPU</th>
              <th>Heap Used</th>
              <th>Event Loop p99</th>
              <th>Operations</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            @for (member of members(); track member.address) {
              <tr>
                <td>
                  <a
                    [routerLink]="[member.address]"
                    class="text-mc-blue hover:underline font-mono text-xs">
                    {{ member.address }}
                  </a>
                </td>
                <td class="text-xs text-mc-text-dim">{{ member.info?.memberVersion ?? 'Unknown' }}</td>
                <td>
                  <span class="flex items-center gap-1.5 text-xs">
                    <span class="mc-status-dot"
                      [class.mc-status-healthy]="member.connected"
                      [class.mc-status-critical]="!member.connected"></span>
                    {{ member.connected ? 'Connected' : 'Disconnected' }}
                  </span>
                </td>
                <td>{{ member.latestSample?.cpu?.percentUsed ?? 0 | number:'1.1-1' }}%</td>
                <td>{{ (member.latestSample?.memory?.heapUsed ?? 0) / 1048576 | number:'1.0-0' }} MB</td>
                <td>{{ member.latestSample?.eventLoop?.p99Ms ?? 0 | number:'1.1-1' }} ms</td>
                <td>{{ member.latestSample?.operation?.completedCount ?? 0 | number }}</td>
                <td class="text-xs text-mc-text-dim">
                  {{ formatLastSeen(member.lastSeen) }}
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="text-center text-mc-text-muted py-8">No members connected</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class MembersComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly wsService = inject(WebSocketService);

  private clusterId: string | null = null;

  readonly members = this.clusterStore.monitorMembers;

  ngOnInit(): void {
    this.clusterId = this.route.parent?.snapshot.paramMap.get('id') ?? null;
    if (this.clusterId) {
      this.clusterStore.setActiveCluster(this.clusterId);
      this.wsService.subscribe(this.clusterId, 'all');
    }
  }

  ngOnDestroy(): void {
    if (this.clusterId) {
      this.wsService.unsubscribe(this.clusterId);
    }
  }

  formatLastSeen(timestamp: number): string {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }
}
