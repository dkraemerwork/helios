/**
 * REST client for making API calls to individual Helios cluster members.
 *
 * Provides typed methods for fetching monitoring data, job information,
 * configuration, and health checks, as well as executing administrative
 * actions (state changes, job control, map operations, GC). All requests
 * use fetch() with AbortController-based timeouts and proper error
 * classification for permanent vs. transient failures.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConnectorError } from '../shared/errors.js';
import type { MonitorPayload } from '../shared/types.js';

const DEFAULT_TIMEOUT_MS = 5_000;

export interface RestResponse<T> {
  data: T;
  status: number;
}

@Injectable()
export class MemberRestClient {
  private readonly logger = new Logger(MemberRestClient.name);

  // ── Read Operations ─────────────────────────────────────────────────────

  async fetchMonitorData(restUrl: string, authToken?: string): Promise<MonitorPayload> {
    return this.get<MonitorPayload>(`${restUrl}/monitor`, authToken);
  }

  async fetchJobs(restUrl: string, authToken?: string): Promise<unknown> {
    return this.get<unknown>(`${restUrl}/jobs`, authToken);
  }

  async fetchConfig(restUrl: string, authToken?: string): Promise<unknown> {
    return this.get<unknown>(`${restUrl}/config`, authToken);
  }

  async fetchHealth(restUrl: string): Promise<{ status: string }> {
    return this.get<{ status: string }>(`${restUrl}/health`);
  }

  async fetchHealthReady(restUrl: string): Promise<{ status: string }> {
    return this.get<{ status: string }>(`${restUrl}/health/ready`);
  }

  // ── Write Operations ────────────────────────────────────────────────────

  async postClusterState(
    restUrl: string,
    state: string,
    authToken?: string,
  ): Promise<unknown> {
    return this.post(`${restUrl}/cluster/state`, { state }, authToken);
  }

  async postJobCancel(
    restUrl: string,
    jobId: string,
    authToken?: string,
  ): Promise<unknown> {
    return this.post(`${restUrl}/jobs/${encodeURIComponent(jobId)}/cancel`, {}, authToken);
  }

  async postJobRestart(
    restUrl: string,
    jobId: string,
    authToken?: string,
  ): Promise<unknown> {
    return this.post(`${restUrl}/jobs/${encodeURIComponent(jobId)}/restart`, {}, authToken);
  }

  async postMapClear(
    restUrl: string,
    mapName: string,
    authToken?: string,
  ): Promise<unknown> {
    return this.post(`${restUrl}/maps/${encodeURIComponent(mapName)}/clear`, {}, authToken);
  }

  async postMapEvict(
    restUrl: string,
    mapName: string,
    authToken?: string,
  ): Promise<unknown> {
    return this.post(`${restUrl}/maps/${encodeURIComponent(mapName)}/evict`, {}, authToken);
  }

  async postGc(restUrl: string, authToken?: string): Promise<unknown> {
    return this.post(`${restUrl}/gc`, {}, authToken);
  }

  // ── HTTP Primitives ─────────────────────────────────────────────────────

  private async get<T>(
    url: string,
    authToken?: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(authToken),
        signal: controller.signal,
      });

      return await handleResponse<T>(url, response);
    } catch (err) {
      throw wrapError(url, 'GET', err);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post<T>(
    url: string,
    body: unknown,
    authToken?: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...buildHeaders(authToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      return await handleResponse<T>(url, response);
    } catch (err) {
      throw wrapError(url, 'POST', err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildHeaders(authToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  return headers;
}

async function handleResponse<T>(url: string, response: Response): Promise<T> {
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const message = `${response.status} ${response.statusText}${bodyText ? `: ${bodyText}` : ''}`;

    switch (response.status) {
      case 401:
        throw new ConnectorError(`Authentication failed for ${url}: ${message}`);
      case 403:
        throw new ConnectorError(`Authorization denied for ${url}: ${message}`);
      case 404:
        throw new ConnectorError(`Endpoint not found: ${url}`);
      default:
        throw new ConnectorError(`Request failed for ${url}: ${message}`);
    }
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  // Fallback: try JSON parse anyway
  const text = await response.text();
  if (text.length === 0) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function wrapError(url: string, method: string, err: unknown): ConnectorError {
  if (err instanceof ConnectorError) return err;

  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return new ConnectorError(`Request timeout: ${method} ${url}`);
    }
    return new ConnectorError(`Network error for ${method} ${url}: ${err.message}`);
  }

  return new ConnectorError(`Unknown error for ${method} ${url}: ${String(err)}`);
}
