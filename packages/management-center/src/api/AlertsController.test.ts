import { describe, expect, test } from 'bun:test';
import { AlertsController } from './AlertsController.js';

describe('AlertsController', () => {
  test('emits alert.resolved when an alert is acknowledged', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const controller = Object.create(AlertsController.prototype) as AlertsController;
    const subject = controller as any;

    subject.connectionFactory = {
      getClient: async () => ({
        execute: async ({ sql }: { sql: string }) => {
          if (sql.includes('SELECT * FROM alert_history WHERE id = ?')) {
            return {
              rows: [{
                id: 42,
                rule_id: 'rule-1',
                cluster_id: 'stress',
                member_addr: '10.0.0.1:5701',
                fired_at: 100,
                resolved_at: null,
                severity: 'critical',
                message: 'High event loop latency',
                metric_value: 250,
                threshold: 200,
                delivery_status_json: '{}',
              }],
            };
          }

          return { rows: [], rowsAffected: 1 };
        },
      }),
    };
    subject.queue = {
      enqueue: async (fn: () => Promise<void>) => await fn(),
    };
    subject.auditRepo = {
      insertAuditEntry: async () => {},
    };
    subject.eventEmitter = {
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
    };

    const result = await controller.acknowledgeAlert('42', { mcUser: { id: 'user-1' } });

    expect(result).toEqual({ ok: true });
    expect(emitted).toContainEqual({
      event: 'alert.resolved',
      payload: {
        clusterId: 'stress',
        ruleId: 'rule-1',
        memberAddr: '10.0.0.1:5701',
        message: 'High event loop latency',
      },
    });
  });
});
