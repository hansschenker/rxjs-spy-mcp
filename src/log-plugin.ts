import { matches, matchToString } from "./match";
import type { Match } from "./match";
import type { PartialLogger } from "./logger";
import type { SpyPlugin } from "./plugin";
import type { SubscriptionRecord } from "./record";
import { toSerializable } from "./serialize";

export type LogNotification =
  | "complete"
  | "error"
  | "next"
  | "subscribe"
  | "unsubscribe";

/** Compact letters used for human-facing output (console, harness panel). */
export const NOTIFICATION_LETTERS: Record<LogNotification, string> = {
  complete: "C",
  error: "E",
  next: "N",
  subscribe: "S",
  unsubscribe: "U",
};

export interface LogEntry {
  error?: unknown;
  notification: LogNotification;
  observableId: number;
  recordId: number;
  tag?: string;
  tick: number;
  timestamp: number;
  value?: unknown;
}

export interface LogSink {
  buffer: (entry: LogEntry) => void;
  logger?: PartialLogger;
}

const PREFIX = "[rxjs-spy]";

/**
 * Logs matching notifications to a console logger and, always, to the spy's
 * ring buffer. Values and errors are serialized at capture time so buffered
 * entries stay JSON-safe and do not retain live references.
 */
export class LogPlugin implements SpyPlugin {
  readonly matchString: string;
  readonly name: string;

  constructor(
    private readonly match_: Match,
    private readonly sink_: LogSink,
  ) {
    this.matchString = matchToString(match_);
    this.name = `log(${this.matchString})`;
  }

  beforeComplete(record: SubscriptionRecord): void {
    this.emit_(record, "complete");
  }

  beforeError(record: SubscriptionRecord, error: unknown): void {
    this.emit_(record, "error", undefined, error);
  }

  beforeNext(record: SubscriptionRecord, value: unknown): void {
    this.emit_(record, "next", value);
  }

  beforeSubscribe(record: SubscriptionRecord): void {
    this.emit_(record, "subscribe");
  }

  beforeUnsubscribe(record: SubscriptionRecord): void {
    this.emit_(record, "unsubscribe");
  }

  private emit_(
    record: SubscriptionRecord,
    notification: LogNotification,
    value?: unknown,
    error?: unknown,
  ): void {
    if (!matches(record, this.match_)) {
      return;
    }
    const entry: LogEntry = {
      notification,
      observableId: record.observableId,
      recordId: record.id,
      tag: record.tag,
      tick: record.tick,
      timestamp: Date.now(),
    };
    if (notification === "next") {
      entry.value = toSerializable(value);
    }
    if (notification === "error") {
      entry.error = toSerializable(error);
    }
    this.sink_.buffer(entry);
    const { logger } = this.sink_;
    if (logger) {
      const identity =
        record.tag !== undefined ? record.tag : `#${record.observableId}`;
      const letter = NOTIFICATION_LETTERS[notification];
      if (notification === "next") {
        logger.log(`${PREFIX} ${letter} ${identity}`, value);
      } else if (notification === "error") {
        logger.log(`${PREFIX} ${letter} ${identity}`, error);
      } else {
        logger.log(`${PREFIX} ${letter} ${identity}`);
      }
    }
  }
}
