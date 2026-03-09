/**
 * Custom error hierarchy for the Helios Management Center.
 *
 * Each error carries a machine-readable `code` and an HTTP `statusCode`,
 * allowing the global exception filter to produce consistent API responses.
 */

export class McError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AuthenticationError extends McError {
  constructor(message = 'Authentication required') {
    super(message, 'AUTHENTICATION_REQUIRED', 401);
  }
}

export class AuthorizationError extends McError {
  constructor(message = 'Insufficient permissions') {
    super(message, 'AUTHORIZATION_DENIED', 403);
  }
}

export class ValidationError extends McError {
  constructor(message = 'Validation failed') {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class NotFoundError extends McError {
  constructor(message = 'Resource not found') {
    super(message, 'NOT_FOUND', 404);
  }
}

export class ConflictError extends McError {
  constructor(message = 'Resource conflict') {
    super(message, 'CONFLICT', 409);
  }
}

export class RateLimitError extends McError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT_EXCEEDED', 429);
  }
}

export class DatabaseError extends McError {
  constructor(message = 'Database operation failed') {
    super(message, 'DATABASE_ERROR', 500);
  }
}

export class ConnectorError extends McError {
  constructor(message = 'Cluster connector error') {
    super(message, 'CONNECTOR_ERROR', 502);
  }
}

export class SsrRenderError extends McError {
  constructor(message = 'Server-side rendering failed') {
    super(message, 'SSR_RENDER_ERROR', 500);
  }
}
