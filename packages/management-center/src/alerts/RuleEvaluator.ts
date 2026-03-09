/**
 * Evaluates alert rules against the current cluster state.
 *
 * Supports three alert scopes:
 *   - any_member:        fires if ANY non-stale member breaches the condition
 *   - all_members:       fires only if ALL non-stale members breach the condition
 *   - cluster_aggregate: uses the average across all non-stale members
 *
 * Delta mode computes (current - previous) for rate-of-change alerting.
 * Stale members (lastSeen older than the rule's stalenessWindowMs) are
 * excluded from evaluation entirely.
 */

import { Injectable, Logger } from '@nestjs/common';
import { MetricPathResolver } from './MetricPathResolver.js';
import { nowMs } from '../shared/time.js';
import type {
  AlertRule,
  AlertOperator,
  ClusterState,
  MemberState,
} from '../shared/types.js';

export interface EvaluationResult {
  memberAddr: string;
  metricValue: number;
  breached: boolean;
}

@Injectable()
export class RuleEvaluator {
  private readonly logger = new Logger(RuleEvaluator.name);

  /**
   * Stores the last observed metric value per rule+member for delta calculations.
   * Key: `${ruleId}:${memberAddr}`
   */
  private readonly lastValues = new Map<string, number>();

  constructor(private readonly pathResolver: MetricPathResolver) {}

  /**
   * Evaluates a single alert rule against the current cluster state.
   * Returns one EvaluationResult per relevant member.
   */
  evaluate(rule: AlertRule, clusterState: ClusterState): EvaluationResult[] {
    const now = nowMs();
    const eligibleMembers = this.getEligibleMembers(clusterState, rule.stalenessWindowMs, now);

    if (eligibleMembers.length === 0) return [];

    switch (rule.scope) {
      case 'any_member':
        return this.evaluatePerMember(rule, eligibleMembers);

      case 'all_members':
        return this.evaluateAllMembers(rule, eligibleMembers);

      case 'cluster_aggregate':
        return this.evaluateClusterAggregate(rule, eligibleMembers);
    }
  }

  /**
   * Returns connected, non-stale members that have a latest sample available.
   */
  private getEligibleMembers(
    clusterState: ClusterState,
    stalenessWindowMs: number,
    now: number,
  ): MemberState[] {
    const result: MemberState[] = [];
    const cutoff = now - stalenessWindowMs;

    for (const member of clusterState.members.values()) {
      if (!member.connected) continue;
      if (member.lastSeen < cutoff) continue;
      if (!member.latestSample) continue;
      result.push(member);
    }

    return result;
  }

  /**
   * Evaluates each member independently — any single breach causes alert.
   */
  private evaluatePerMember(rule: AlertRule, members: MemberState[]): EvaluationResult[] {
    const results: EvaluationResult[] = [];

    for (const member of members) {
      const value = this.resolveValue(rule, member);
      if (value === null) continue;

      results.push({
        memberAddr: member.address,
        metricValue: value,
        breached: this.checkCondition(value, rule.operator, rule.threshold),
      });
    }

    return results;
  }

  /**
   * Evaluates all members together — condition must be true for every member.
   * Reports each member individually, but marks all as breached only if every
   * eligible member breaches.
   */
  private evaluateAllMembers(rule: AlertRule, members: MemberState[]): EvaluationResult[] {
    const raw: Array<{ memberAddr: string; metricValue: number; breached: boolean }> = [];
    let allBreached = true;

    for (const member of members) {
      const value = this.resolveValue(rule, member);
      if (value === null) {
        allBreached = false;
        continue;
      }

      const breached = this.checkCondition(value, rule.operator, rule.threshold);
      if (!breached) allBreached = false;

      raw.push({ memberAddr: member.address, metricValue: value, breached });
    }

    // In all_members mode, override breached to the collective result
    return raw.map((r) => ({
      memberAddr: r.memberAddr,
      metricValue: r.metricValue,
      breached: allBreached,
    }));
  }

  /**
   * Aggregates across all eligible members (arithmetic mean) and evaluates
   * the condition against the aggregate. Returns a single result with
   * memberAddr set to '*' to represent the cluster aggregate.
   */
  private evaluateClusterAggregate(
    rule: AlertRule,
    members: MemberState[],
  ): EvaluationResult[] {
    let sum = 0;
    let count = 0;

    for (const member of members) {
      const value = this.resolveValue(rule, member);
      if (value === null) continue;
      sum += value;
      count++;
    }

    if (count === 0) return [];

    const avg = sum / count;
    return [
      {
        memberAddr: '*',
        metricValue: avg,
        breached: this.checkCondition(avg, rule.operator, rule.threshold),
      },
    ];
  }

  /**
   * Resolves the metric value for a given member, applying delta mode if enabled.
   */
  private resolveValue(rule: AlertRule, member: MemberState): number | null {
    const sample = member.latestSample;
    if (!sample) return null;

    const rawValue = this.pathResolver.resolve(rule.metric, sample);
    if (rawValue === null) return null;

    if (!rule.deltaMode) return rawValue;

    // Delta mode: compute difference from last known value
    const key = `${rule.id}:${member.address}`;
    const previous = this.lastValues.get(key);
    this.lastValues.set(key, rawValue);

    if (previous === undefined) return null; // No delta available on first observation
    return rawValue - previous;
  }

  /**
   * Evaluates a value against a threshold using the given operator.
   */
  private checkCondition(value: number, operator: AlertOperator, threshold: number): boolean {
    switch (operator) {
      case '>':
        return value > threshold;
      case '>=':
        return value >= threshold;
      case '<':
        return value < threshold;
      case '<=':
        return value <= threshold;
      case '==':
        return value === threshold;
    }
  }
}
