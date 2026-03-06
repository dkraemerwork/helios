/**
 * Resolves and validates Mongo MapStore properties from MapStoreConfig.properties.
 *
 * Enforces the configuration contract from MONGODB_MAPSTORE_PRODUCTION_PLAN.md:
 * - document mode only (blob is rejected)
 * - deterministic defaults and precedence
 * - fast-fail validation for illegal combinations
 */

export interface ResolvedMongoProperties {
  connectionString: string | null;
  database: string | null;
  externalName: string | null;
  mode: 'document';
  idColumn: string;
  columns: string[] | null;
  singleColumnAsValue: boolean;
  replaceStrategy: 'updateOne' | 'replaceOne';
  loadAllKeys: boolean;
  upsert: boolean;
  readPreference: string | null;
  writeConcern: string | null;
  retryWrites: boolean | null;
  maxBatchSize: number | null;
  connectTimeoutMs: number | null;
  serverSelectionTimeoutMs: number | null;
}

function parseBoolean(key: string, value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean value for '${key}': '${value}'. Expected 'true' or 'false'.`);
}

function parseOptionalInt(key: string, value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid integer value for '${key}': '${value}'`);
  }
  return n;
}

export class MongoPropertyResolver {
  static resolve(props: Map<string, string>): ResolvedMongoProperties {
    const mode = props.get('mode') ?? 'document';
    if (mode !== 'document') {
      throw new Error(
        `Mode '${mode}' is not supported. Only 'document' mode is supported for MongoDB MapStore.`,
      );
    }

    const columnsRaw = props.get('columns');
    const columns = columnsRaw ? columnsRaw.split(',').map((c) => c.trim()).filter(Boolean) : null;

    const singleColumnAsValue = props.has('single-column-as-value')
      ? parseBoolean('single-column-as-value', props.get('single-column-as-value')!)
      : false;

    const replaceStrategyRaw = props.get('replace-strategy');
    let replaceStrategy: 'updateOne' | 'replaceOne';
    if (replaceStrategyRaw !== undefined) {
      if (replaceStrategyRaw !== 'updateOne' && replaceStrategyRaw !== 'replaceOne') {
        throw new Error(
          `Invalid replace-strategy '${replaceStrategyRaw}'. Expected 'updateOne' or 'replaceOne'.`,
        );
      }
      replaceStrategy = replaceStrategyRaw;
    } else {
      replaceStrategy = 'updateOne';
    }

    const loadAllKeys = props.has('load-all-keys')
      ? parseBoolean('load-all-keys', props.get('load-all-keys')!)
      : true;

    const upsert = props.has('upsert')
      ? parseBoolean('upsert', props.get('upsert')!)
      : true;

    // Validation: single-column-as-value requires exactly one non-id column
    if (singleColumnAsValue) {
      if (!columns || columns.length !== 1) {
        throw new Error(
          `single-column-as-value=true requires exactly one non-id column in 'columns'. ` +
          `Got: ${columns ? columns.length : 0} columns.`,
        );
      }
    }

    // Validation: replaceOne is invalid when columns projection is set
    if (replaceStrategy === 'replaceOne' && columns !== null && columns.length > 0) {
      throw new Error(
        `replace-strategy 'replaceOne' is invalid when 'columns' projection is set. ` +
        `Use 'updateOne' instead.`,
      );
    }

    return {
      connectionString: props.get('connection-string') ?? null,
      database: props.get('database') ?? null,
      externalName: props.get('external-name') ?? null,
      mode: 'document',
      idColumn: props.get('id-column') ?? '_id',
      columns,
      singleColumnAsValue,
      replaceStrategy,
      loadAllKeys,
      upsert,
      readPreference: props.get('read-preference') ?? null,
      writeConcern: props.get('write-concern') ?? null,
      retryWrites: props.has('retry-writes') ? parseBoolean('retry-writes', props.get('retry-writes')!) : null,
      maxBatchSize: parseOptionalInt('max-batch-size', props.get('max-batch-size')),
      connectTimeoutMs: parseOptionalInt('connect-timeout-ms', props.get('connect-timeout-ms')),
      serverSelectionTimeoutMs: parseOptionalInt('server-selection-timeout-ms', props.get('server-selection-timeout-ms')),
    };
  }
}
