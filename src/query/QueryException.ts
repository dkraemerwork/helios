export class QueryException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryException';
  }
}
