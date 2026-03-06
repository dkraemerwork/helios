/**
 * Document mapping engine for MongoDB MapStore.
 *
 * Handles key/value <-> BSON document mapping with:
 * - configurable id column (_id default)
 * - column projection
 * - single-column-as-value mode
 * - updateOne ($set) vs replaceOne strategies
 * - frozen null/undefined/missing field semantics
 */

export interface MongoDocumentMapperOptions {
  idColumn: string;
  columns?: string[] | null;
  singleColumnAsValue?: boolean;
  replaceStrategy?: 'updateOne' | 'replaceOne';
}

export class MongoDocumentMapper {
  private readonly _idColumn: string;
  private readonly _columns: string[] | null;
  private readonly _singleColumnAsValue: boolean;
  private readonly _replaceStrategy: 'updateOne' | 'replaceOne';

  constructor(options: MongoDocumentMapperOptions) {
    this._idColumn = options.idColumn;
    this._columns = options.columns ?? null;
    this._singleColumnAsValue = options.singleColumnAsValue ?? false;
    this._replaceStrategy = options.replaceStrategy ?? 'updateOne';
  }

  /**
   * Convert a key + value into a Mongo document for storage.
   */
  toDocument(key: unknown, value: unknown): Record<string, unknown> {
    const doc: Record<string, unknown> = { [this._idColumn]: key };

    if (value === null || value === undefined) {
      return doc;
    }

    if (this._singleColumnAsValue && this._columns && this._columns.length === 1) {
      doc[this._columns[0]] = value;
      return doc;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (this._columns) {
        for (const col of this._columns) {
          if (col in obj) {
            doc[col] = obj[col];
          }
        }
      } else {
        for (const [k, v] of Object.entries(obj)) {
          if (k !== this._idColumn) {
            doc[k] = v;
          }
        }
      }
    }

    return doc;
  }

  /**
   * Extract key and value from a Mongo document.
   */
  fromDocument(doc: Record<string, unknown>): { key: unknown; value: unknown } {
    const key = doc[this._idColumn];

    if (this._singleColumnAsValue && this._columns && this._columns.length === 1) {
      return { key, value: doc[this._columns[0]] ?? null };
    }

    const value: Record<string, unknown> = {};
    let hasFields = false;

    if (this._columns) {
      for (const col of this._columns) {
        if (col in doc) {
          value[col] = doc[col];
          hasFields = true;
        }
      }
    } else {
      for (const [k, v] of Object.entries(doc)) {
        if (k !== this._idColumn) {
          value[k] = v;
          hasFields = true;
        }
      }
    }

    return { key, value: hasFields ? value : null };
  }

  /**
   * Create the update document for store operations.
   * - updateOne strategy: { $set: { ...fields } }
   * - replaceOne strategy: { ...fields } (full replacement)
   */
  toUpdateDoc(value: unknown): Record<string, unknown> {
    if (this._replaceStrategy === 'replaceOne') {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k !== this._idColumn) {
            result[k] = v;
          }
        }
        return result;
      }
      return {};
    }

    // updateOne: wrap in $set
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k !== this._idColumn) {
          fields[k] = v;
        }
      }
      return { $set: fields };
    }
    return { $set: {} };
  }

  get idColumn(): string {
    return this._idColumn;
  }
}
