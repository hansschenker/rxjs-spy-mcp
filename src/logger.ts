export interface PartialLogger {
  error?(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
}

export const defaultLogger: PartialLogger = console;
