import type { Index } from './Index';

/** Hint controlling which index type to prefer when multiple indexes exist. */
export enum IndexMatchHint {
  PREFER_ORDERED = 'PREFER_ORDERED',
  PREFER_UNORDERED = 'PREFER_UNORDERED',
}

/**
 * Context object passed to index-aware predicates during query execution.
 * Equivalent to Java's QueryContext.
 */
export interface QueryContext {
  matchIndex(attribute: string, hint: IndexMatchHint): Index | null;
}
