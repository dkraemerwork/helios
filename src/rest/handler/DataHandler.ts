const JSON_HEADERS = { "Content-Type": "application/json" };

/** Minimal map view needed by DataHandler. Keys and values are JSON-serialisable. */
export interface DataHandlerMap {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<unknown>;
  remove(key: string): Promise<unknown>;
}

/** Minimal queue view needed by DataHandler. */
export interface DataHandlerQueue {
  size(): number | Promise<number>;
  offer(element: unknown): boolean | Promise<boolean>;
  poll(timeoutMs?: number): unknown | Promise<unknown>;
}

/**
 * Provider interface implemented by HeliosInstanceImpl (and injectable in tests).
 * Returns null when the named structure does not exist.
 */
export interface DataHandlerStore {
  getMap(name: string): Promise<DataHandlerMap | null>;
  getQueue(name: string): Promise<DataHandlerQueue | null>;
}

/**
 * Handles the DATA endpoint group.
 *
 * Map endpoints:
 *  GET    /hazelcast/rest/maps/{name}/{key}   → 200 + JSON | 204 No Content if absent
 *  POST   /hazelcast/rest/maps/{name}/{key}   → body: JSON value → 200 OK
 *  DELETE /hazelcast/rest/maps/{name}/{key}   → 200 OK
 *
 * Queue endpoints:
 *  GET    /hazelcast/rest/queues/{name}/size  → {"size": N}
 *  POST   /hazelcast/rest/queues/{name}       → 200 OK | 503 if queue full
 *  GET    /hazelcast/rest/queues/{name}/{timeout} → poll → 200 + value | 204 on empty
 *
 * Analogous to com.hazelcast.internal.management.rest.DataHandler.
 */
export class DataHandler {
  constructor(private readonly _store: DataHandlerStore) {}

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // /hazelcast/rest/maps/{name}/{key}
    if (path.startsWith("/hazelcast/rest/maps/")) {
      return this._handleMap(req, path, method);
    }

    // /hazelcast/rest/queues/{name}[/size|/{timeout}]
    if (path.startsWith("/hazelcast/rest/queues/")) {
      return this._handleQueue(req, path, method);
    }

    return this._notFound("Unknown data endpoint.");
  }

  // ─── Map ──────────────────────────────────────────────────────────────────

  private async _handleMap(
    req: Request,
    path: string,
    method: string,
  ): Promise<Response> {
    // path format: /hazelcast/rest/maps/{name}/{key}
    const rest = path.slice("/hazelcast/rest/maps/".length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      return this._notFound("Missing map key in path.");
    }
    const mapName = rest.slice(0, slash);
    const key = rest.slice(slash + 1);

    if (!mapName || !key) {
      return this._notFound("Missing map name or key.");
    }

    const map = await this._store.getMap(mapName);
    if (map === null) {
      return this._notFound(`Map '${mapName}' not found.`);
    }

    if (method === "GET") {
      const value = await map.get(key);
      if (value === null || value === undefined) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    if (method === "POST") {
      const body = await this._parseJson(req);
      await map.put(key, body);
      return this._ok();
    }

    if (method === "DELETE") {
      await map.remove(key);
      return this._ok();
    }

    return this._notFound(`Unsupported method ${method} for map endpoint.`);
  }

  // ─── Queue ────────────────────────────────────────────────────────────────

  private async _handleQueue(
    req: Request,
    path: string,
    method: string,
  ): Promise<Response> {
    // path format: /hazelcast/rest/queues/{name}[/size|/{timeout}]
    const rest = path.slice("/hazelcast/rest/queues/".length);
    const slash = rest.indexOf("/");

    // POST /hazelcast/rest/queues/{name} — no trailing segment
    if (slash === -1) {
      const queueName = rest;
      if (!queueName) return this._notFound("Missing queue name.");

      if (method === "POST") {
        const queue = await this._store.getQueue(queueName);
        if (queue === null)
          return this._notFound(`Queue '${queueName}' not found.`);
        const body = await this._parseJson(req);
        const accepted = await queue.offer(body);
        if (!accepted) {
          return new Response(
            JSON.stringify({ status: 503, message: "Queue is full." }),
            { status: 503, headers: JSON_HEADERS },
          );
        }
        return this._ok();
      }

      return this._notFound(`Unsupported method ${method} for queue endpoint.`);
    }

    const queueName = rest.slice(0, slash);
    const segment = rest.slice(slash + 1);

    if (!queueName) return this._notFound("Missing queue name.");

    const queue = await this._store.getQueue(queueName);
    if (queue === null)
      return this._notFound(`Queue '${queueName}' not found.`);

    // GET /hazelcast/rest/queues/{name}/size
    if (segment === "size") {
      return new Response(JSON.stringify({ size: await queue.size() }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    // GET /hazelcast/rest/queues/{name}/{timeout} — poll with optional timeout (seconds)
    if (method === "GET") {
      const timeoutSeconds = Number.parseInt(segment, 10);
      if (Number.isNaN(timeoutSeconds)) {
        return this._notFound(`Invalid queue timeout '${segment}'.`);
      }
      const value = await queue.poll(timeoutSeconds * 1000);
      if (value === null || value === undefined) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    return this._notFound("Unknown queue endpoint.");
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async _parseJson(req: Request): Promise<unknown> {
    try {
      return (await req.json()) as unknown;
    } catch {
      return null;
    }
  }

  private _ok(): Response {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  private _notFound(message: string): Response {
    return new Response(JSON.stringify({ status: 404, message }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }
}
