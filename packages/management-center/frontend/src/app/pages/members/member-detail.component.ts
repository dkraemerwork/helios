import { Component, OnInit, OnDestroy, inject, computed, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { ClusterStore, type MemberStoreState } from '../../core/store/cluster.store';
import { WebSocketService } from '../../core/services/websocket.service';

@Component({
  selector: 'mc-member-detail',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="space-y-6 animate-fade-in">
      @if (member(); as m) {
        <!-- Header -->
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-xl font-semibold text-mc-text font-mono">{{ m.address }}</h1>
            <p class="text-sm text-mc-text-dim mt-1">
              {{ m.info?.memberVersion ?? 'Unknown version' }}
              @if (m.info?.liteMember) { &middot; Lite Member }
            </p>
          </div>
          <span class="flex items-center gap-1.5">
            <span class="mc-status-dot"
              [class.mc-status-healthy]="m.connected"
              [class.mc-status-critical]="!m.connected"></span>
            {{ m.connected ? 'Connected' : 'Disconnected' }}
          </span>
        </div>

        <!-- Metric cards -->
        @if (m.latestSample; as s) {
          <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div class="mc-panel p-4">
              <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">CPU</div>
              <div class="text-2xl font-semibold text-mc-text">{{ s.cpu.percentUsed | number:'1.1-1' }}%</div>
            </div>
            <div class="mc-panel p-4">
              <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Heap Used</div>
              <div class="text-2xl font-semibold text-mc-text">{{ s.memory.heapUsed / 1048576 | number:'1.0-0' }} MB</div>
              <div class="text-xs text-mc-text-dim mt-1">of {{ s.memory.heapTotal / 1048576 | number:'1.0-0' }} MB</div>
            </div>
            <div class="mc-panel p-4">
              <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">RSS</div>
              <div class="text-2xl font-semibold text-mc-text">{{ s.memory.rss / 1048576 | number:'1.0-0' }} MB</div>
            </div>
            <div class="mc-panel p-4">
              <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Event Loop p99</div>
              <div class="text-2xl font-semibold text-mc-text">{{ s.eventLoop.p99Ms | number:'1.1-1' }} ms</div>
              <div class="text-xs text-mc-text-dim mt-1">max: {{ s.eventLoop.maxMs | number:'1.1-1' }} ms</div>
            </div>
            <div class="mc-panel p-4">
              <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Operations</div>
              <div class="text-2xl font-semibold text-mc-text">{{ s.operation.completedCount | number }}</div>
              <div class="text-xs text-mc-text-dim mt-1">queue: {{ s.operation.queueSize }}</div>
            </div>
            <div class="mc-panel p-4">
              <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Transport</div>
              <div class="text-sm text-mc-text">
                <span class="text-mc-emerald">R:</span> {{ s.transport.bytesRead / 1024 | number:'1.0-0' }} KB
              </div>
              <div class="text-sm text-mc-text">
                <span class="text-mc-blue">W:</span> {{ s.transport.bytesWritten / 1024 | number:'1.0-0' }} KB
              </div>
            </div>
            <div class="mc-panel p-4">
              <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Migrations</div>
              <div class="text-2xl font-semibold text-mc-text">{{ s.migration.activeMigrations }}</div>
              <div class="text-xs text-mc-text-dim mt-1">completed: {{ s.migration.completedMigrations }}</div>
            </div>
            <div class="mc-panel p-4">
              <div class="text-xs text-mc-text-muted uppercase tracking-wide mb-1">Invocations</div>
              <div class="text-2xl font-semibold text-mc-text">{{ s.invocation.usedPercentage | number:'1.0-0' }}%</div>
              <div class="text-xs text-mc-text-dim mt-1">pending: {{ s.invocation.pendingCount }}</div>
            </div>
          </div>
        }

        <!-- Error state -->
        @if (m.error) {
          <div class="mc-panel p-4 border-mc-red/30">
            <div class="text-sm text-mc-red font-medium">Connection Error</div>
            <div class="text-xs text-mc-text-dim mt-1">{{ m.error }}</div>
          </div>
        }
      } @else {
        <div class="text-center py-16 text-mc-text-muted">
          Member not found or not yet connected.
        </div>
      }
    </div>
  `,
})
export class MemberDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly clusterStore = inject(ClusterStore);
  private readonly wsService = inject(WebSocketService);

  private clusterId: string | null = null;
  private memberAddress: string | null = null;

  readonly member = computed((): MemberStoreState | null => {
    const cluster = this.clusterStore.activeCluster();
    if (!cluster || !this.memberAddress) return null;
    return cluster.members.get(this.memberAddress) ?? null;
  });

  ngOnInit(): void {
    this.clusterId = this.route.parent?.snapshot.paramMap.get('id') ?? null;
    this.memberAddress = this.route.snapshot.paramMap.get('address');

    if (this.clusterId) {
      this.clusterStore.setActiveCluster(this.clusterId);
      if (this.memberAddress) {
        this.wsService.subscribe(this.clusterId, this.memberAddress);
      }
    }
  }

  ngOnDestroy(): void {
    if (this.clusterId) {
      this.wsService.unsubscribe(this.clusterId);
    }
  }
}
