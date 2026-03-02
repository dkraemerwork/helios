/** Utility class for validating arguments and state (port of Java Preconditions). */
export class Preconditions {
  private constructor() {}

  static checkNotNull<T>(value: T | null | undefined, message: string): T {
    if (value == null) throw new Error(message);
    return value;
  }

  static isNotNull<T>(value: T | null | undefined, argName: string): T {
    if (value == null) throw new Error(`argument '${argName}' can't be null`);
    return value;
  }

  static checkTrue(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
  }

  static checkFalse(condition: boolean, message: string): void {
    if (condition) throw new Error(message);
  }

  static checkState(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
  }

  static checkNotNegative(value: number, message: string): number {
    if (value < 0) throw new Error(message);
    return value;
  }

  static checkNegative(value: number, message: string): number {
    if (value >= 0) throw new Error(message);
    return value;
  }

  static checkPositive(value: number, message: string): number {
    if (value <= 0) throw new Error(message);
    return value;
  }

  static checkHasText(value: string | null | undefined, message: string): string {
    if (value == null || value.length === 0) throw new Error(message);
    return value;
  }

  static checkBackupCount(newBackupCount: number, currentAsyncBackupCount: number): number {
    const MAX_BACKUP_COUNT = 6;
    if (newBackupCount < 0 || currentAsyncBackupCount < 0) {
      throw new Error('backup count must not be negative');
    }
    if (newBackupCount + currentAsyncBackupCount > MAX_BACKUP_COUNT) {
      throw new Error(`Total backup count ${newBackupCount + currentAsyncBackupCount} exceeds max ${MAX_BACKUP_COUNT}`);
    }
    return newBackupCount;
  }

  static checkInstanceOf<T>(type: new (...args: unknown[]) => T, obj: unknown, message: string): T {
    if (!(obj instanceof type)) throw new Error(message);
    return obj as T;
  }

  static checkNotInstanceOf<T>(type: new (...args: unknown[]) => T, obj: unknown, message: string): void {
    if (obj instanceof type) throw new Error(message);
  }
}
