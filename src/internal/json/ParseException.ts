import { Location } from '@zenystx/core/internal/json/Location';

/** Unchecked exception thrown when JSON parsing fails. */
export class ParseException extends Error {
  private readonly _location: Location;

  constructor(message: string, location: Location) {
    super(`${message} at ${location}`);
    this.name = 'ParseException';
    this._location = location;
  }

  getLocation(): Location {
    return this._location;
  }
}
