import { Observable, Subscription } from "rxjs";
import type { Observer } from "rxjs";
import { identify } from "./identify";
import { LogPlugin } from "./log-plugin";
import type { LogEntry } from "./log-plugin";
import { defaultLogger } from "./logger";
import type { PartialLogger } from "./logger";
import { matchToString } from "./match";
import type { Match } from "./match";
import { getTag, isHidden } from "./metadata";
import type { SpyPlugin } from "./plugin";
import { isClosed } from "./record";
import type { SubscriptionRecord } from "./record";
import { RingBuffer } from "./ring-buffer";
import { snapshot } from "./snapshot";
import type { SnapshotOptions, SnapshotResult } from "./snapshot";
import { installSurface } from "./surface";
import { VERSION } from "./version";

export interface SpyOptions {
  /** Name of the global property the MCP surface is installed on. Default: "__RXJS_SPY__". */
  global?: string;
  /** Install the MCP surface on globalThis. Default: true. */
  installGlobal?: boolean;
  /** Milliseconds for which records of closed subscriptions are kept. Default: 30000. */
  keptDuration?: number;
  /** Number of latest next values kept per subscription. Default: 4. */
  keptValues?: number;
  /** Capacity of the log-entry ring buffer. Default: 1000. */
  logBufferSize?: number;
  logger?: PartialLogger;
  /** Capture subscribe-time stack traces. Default: true. */
  stackTraces?: boolean;
}

export interface LogHandle {
  logId: number;
  match: string;
}

interface StackEntry {
  kind: "next" | "subscribe";
  record: SubscriptionRecord;
}

type SubscribeFn = typeof Observable.prototype.subscribe;
type GenericSubscribe = (
  this: Observable<unknown>,
  ...args: unknown[]
) => Subscription;

let currentSpy: Spy | undefined;
let suppressDepth = 0;

export function create(options: SpyOptions = {}): Spy {
  return new Spy(options);
}

/**
 * The spy patches Observable.prototype.subscribe (public API only - no
 * RxJS internals) and keeps a SubscriptionRecord per observed subscribe.
 * Graph relationships are inferred from a notification stack: a subscribe
 * that happens while another record's subscribe is on the stack is a
 * structural source; one that happens during a next notification is a
 * flattening (e.g. mergeMap/switchMap inner subscriptions).
 */
export class Spy {
  private readonly keptDuration_: number;
  private readonly keptValues_: number;
  private readonly logBuffer_: RingBuffer<LogEntry>;
  private readonly logPlugins_ = new Map<number, LogPlugin>();
  private readonly logger_: PartialLogger;
  private readonly originalSubscribe_: SubscribeFn;
  private readonly patchedSubscribe_: SubscribeFn;
  private readonly plugins_: SpyPlugin[] = [];
  private readonly records_ = new Map<number, SubscriptionRecord>();
  private readonly stack_: StackEntry[] = [];
  private readonly stackTraces_: boolean;
  private readonly uninstallSurface_: (() => void) | undefined;
  private nextLogId_ = 0;
  private nextRecordId_ = 0;
  private tick_ = 0;
  private torndown_ = false;

  constructor(options: SpyOptions = {}) {
    if (currentSpy) {
      throw new Error("Already spying on Observable.prototype.subscribe.");
    }
    this.keptDuration_ = options.keptDuration ?? 30_000;
    this.keptValues_ = options.keptValues ?? 4;
    this.logBuffer_ = new RingBuffer<LogEntry>(options.logBufferSize ?? 1_000);
    this.logger_ = options.logger ?? defaultLogger;
    this.stackTraces_ = options.stackTraces ?? true;
    this.originalSubscribe_ = Observable.prototype.subscribe;
    this.patchedSubscribe_ = Spy.createPatchedSubscribe_(
      this,
      this.originalSubscribe_ as GenericSubscribe,
    ) as SubscribeFn;
    Observable.prototype.subscribe = this.patchedSubscribe_;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- module-level active-spy registration, not a local alias
    currentSpy = this;
    if (options.installGlobal !== false) {
      this.uninstallSurface_ = installSurface(
        this,
        options.global ?? "__RXJS_SPY__",
      );
    }
  }

  get tick(): number {
    return this.tick_;
  }

  get version(): string {
    return VERSION;
  }

  plug(plugin: SpyPlugin): () => void {
    this.plugins_.push(plugin);
    return () => this.unplug(plugin);
  }

  unplug(plugin: SpyPlugin): void {
    const index = this.plugins_.indexOf(plugin);
    if (index !== -1) {
      this.plugins_.splice(index, 1);
      plugin.teardown?.();
    }
  }

  /** Starts logging notifications for matching records; matches everything when omitted. */
  log(match?: Match, options: { console?: boolean } = {}): LogHandle {
    const effective: Match = match ?? (() => true);
    const plugin = new LogPlugin(effective, {
      buffer: (entry) => {
        this.logBuffer_.push(entry);
      },
      logger: options.console === false ? undefined : this.logger_,
    });
    this.plug(plugin);
    const logId = ++this.nextLogId_;
    this.logPlugins_.set(logId, plugin);
    return { logId, match: matchToString(effective) };
  }

  /** Stops one log (or all when logId is omitted); returns how many were removed. */
  unlog(logId?: number): number {
    const entries = [...this.logPlugins_.entries()].filter(
      ([id]) => logId === undefined || id === logId,
    );
    for (const [id, plugin] of entries) {
      this.logPlugins_.delete(id);
      this.unplug(plugin);
    }
    return entries.length;
  }

  logs(): LogHandle[] {
    return [...this.logPlugins_.entries()].map(([logId, plugin]) => ({
      logId,
      match: plugin.matchString,
    }));
  }

  logEntries(
    sinceIndex = 0,
    limit = 100,
  ): { entries: (LogEntry & { index: number })[]; nextIndex: number } {
    return {
      entries: this.logBuffer_
        .since(sinceIndex, limit)
        .map(({ index, item }) => ({ index, ...item })),
      nextIndex: this.logBuffer_.nextIndex,
    };
  }

  records(): SubscriptionRecord[] {
    return [...this.records_.values()];
  }

  snapshot(options: SnapshotOptions = {}): SnapshotResult {
    this.flush();
    return snapshot(this.records(), options);
  }

  /**
   * Removes records of closed subscriptions whose entire source subtree is
   * also closed - immediately with `force`, otherwise only once they have
   * been closed for longer than keptDuration.
   */
  flush(force = false): number {
    const now = Date.now();
    const deletable = new Set<SubscriptionRecord>();
    const canDelete = (record: SubscriptionRecord): boolean => {
      if (deletable.has(record)) {
        return true;
      }
      const expired =
        force ||
        (record.closedAt !== undefined &&
          now - record.closedAt >= this.keptDuration_);
      if (isClosed(record) && expired && record.sources.every(canDelete)) {
        deletable.add(record);
        return true;
      }
      return false;
    };
    for (const record of this.records_.values()) {
      canDelete(record);
    }
    for (const record of deletable) {
      this.records_.delete(record.id);
      if (record.sink && !deletable.has(record.sink)) {
        record.sink.sources = record.sink.sources.filter(
          (source) => source !== record,
        );
      }
    }
    return deletable.size;
  }

  teardown(): void {
    if (this.torndown_) {
      return;
    }
    this.torndown_ = true;
    for (const plugin of this.plugins_.splice(0)) {
      plugin.teardown?.();
    }
    this.logPlugins_.clear();
    if (Observable.prototype.subscribe === this.patchedSubscribe_) {
      Observable.prototype.subscribe = this.originalSubscribe_;
    } else {
      this.logger_.warn?.(
        "[rxjs-spy] Observable.prototype.subscribe was re-patched by other code after rxjs-spy; leaving it in place.",
      );
    }
    if (currentSpy === this) {
      currentSpy = undefined;
    }
    this.uninstallSurface_?.();
  }

  private static createPatchedSubscribe_(
    spy: Spy,
    original: GenericSubscribe,
  ): GenericSubscribe {
    return function (
      this: Observable<unknown>,
      ...args: unknown[]
    ): Subscription {
      if (currentSpy !== spy || suppressDepth > 0) {
        return original.apply(this, args);
      }
      if (isHidden(this)) {
        // Hide the whole synchronous subscription subtree, mirroring the
        // legacy behavior of nulling the spy for nested subscribes.
        suppressDepth += 1;
        try {
          return original.apply(this, args);
        } finally {
          suppressDepth -= 1;
        }
      }
      return spy.spySubscribe_(this, args);
    };
  }

  private spySubscribe_(
    observable: Observable<unknown>,
    args: unknown[],
  ): Subscription {
    const observer = toPartialObserver(args);
    const record = this.createRecord_(observable);
    const top = this.stack_[this.stack_.length - 1];
    if (top) {
      record.sink = top.record;
      record.rootSink = top.record.rootSink ?? top.record;
      record.flattened = top.kind === "next";
      top.record.sources.push(record);
    }
    this.records_.set(record.id, record);
    record.tick = ++this.tick_;
    this.notify_("beforeSubscribe", record);
    this.stack_.push({ kind: "subscribe", record });
    let subscription: Subscription;
    try {
      const wrapped: Partial<Observer<unknown>> = {
        complete: () => this.observeComplete_(record, observer),
        error: (error: unknown) => this.observeError_(record, observer, error),
        next: (value: unknown) => this.observeNext_(record, observer, value),
      };
      subscription = (this.originalSubscribe_ as GenericSubscribe).call(
        observable,
        wrapped,
      );
    } finally {
      this.stack_.pop();
    }
    record.subscription = subscription;
    const originalUnsubscribe = subscription.unsubscribe.bind(subscription);
    subscription.unsubscribe = () => {
      if (isClosed(record)) {
        originalUnsubscribe();
        return;
      }
      record.tick = ++this.tick_;
      this.notify_("beforeUnsubscribe", record);
      record.unsubscribed = true;
      record.closedAt = Date.now();
      originalUnsubscribe();
      this.notify_("afterUnsubscribe", record);
    };
    const [first] = args;
    if (first instanceof Subscription && first !== subscription) {
      // Stock subscribe() registers the source teardown on a caller-supplied
      // Subscriber; restore that linkage so operator-driven unsubscription
      // (e.g. switchMap cancelling its inner) still tears down the source.
      first.add(subscription);
    }
    this.notify_("afterSubscribe", record);
    return subscription;
  }

  private observeNext_(
    record: SubscriptionRecord,
    observer: Partial<Observer<unknown>>,
    value: unknown,
  ): void {
    record.tick = ++this.tick_;
    record.nextCount += 1;
    record.latestValues.push(value);
    if (record.latestValues.length > this.keptValues_) {
      record.latestValues.shift();
    }
    this.notify_("beforeNext", record, value);
    this.stack_.push({ kind: "next", record });
    try {
      observer.next?.(value);
    } finally {
      this.stack_.pop();
    }
    this.notify_("afterNext", record, value);
  }

  private observeError_(
    record: SubscriptionRecord,
    observer: Partial<Observer<unknown>>,
    error: unknown,
  ): void {
    record.tick = ++this.tick_;
    this.notify_("beforeError", record, error);
    record.error = error;
    record.errored = true;
    record.closedAt = Date.now();
    if (observer.error) {
      observer.error(error);
    } else {
      // No consumer error handler: rethrow so RxJS's consumer-observer
      // catch routes this to its unhandled-error reporting, exactly as it
      // would without the spy.
      throw error;
    }
    this.notify_("afterError", record, error);
  }

  private observeComplete_(
    record: SubscriptionRecord,
    observer: Partial<Observer<unknown>>,
  ): void {
    record.tick = ++this.tick_;
    this.notify_("beforeComplete", record);
    record.completed = true;
    record.closedAt = Date.now();
    observer.complete?.();
    this.notify_("afterComplete", record);
  }

  private createRecord_(observable: Observable<unknown>): SubscriptionRecord {
    return {
      closedAt: undefined,
      completed: false,
      error: undefined,
      errored: false,
      flattened: false,
      id: ++this.nextRecordId_,
      latestValues: [],
      nextCount: 0,
      observable,
      observableId: identify(observable),
      observableType: observable.constructor?.name ?? "Observable",
      rootSink: undefined,
      sink: undefined,
      sources: [],
      stackTrace: this.stackTraces_ ? captureStackTrace() : undefined,
      subscribedAt: Date.now(),
      subscription: undefined,
      tag: getTag(observable),
      tick: this.tick_,
      unsubscribed: false,
    };
  }

  private notify_(
    hook: Exclude<keyof SpyPlugin, "name" | "teardown">,
    record: SubscriptionRecord,
    arg?: unknown,
  ): void {
    for (const plugin of this.plugins_.slice()) {
      const method = plugin[hook];
      if (typeof method !== "function") {
        continue;
      }
      try {
        (
          method as (
            this: SpyPlugin,
            record: SubscriptionRecord,
            arg?: unknown,
          ) => void
        ).call(plugin, record, arg);
      } catch (error) {
        this.logger_.warn?.(
          `[rxjs-spy] plugin "${plugin.name}" ${hook} hook failed`,
          error,
        );
      }
    }
  }
}

function toPartialObserver(args: unknown[]): Partial<Observer<unknown>> {
  const [observerOrNext, error, complete] = args;
  if (observerOrNext !== null && typeof observerOrNext === "object") {
    return observerOrNext as Partial<Observer<unknown>>;
  }
  return {
    complete: (complete as (() => void) | null | undefined) ?? undefined,
    error: (error as ((error: unknown) => void) | null | undefined) ?? undefined,
    next:
      (observerOrNext as ((value: unknown) => void) | null | undefined) ??
      undefined,
  };
}

function captureStackTrace(): string[] {
  const stack = new Error().stack;
  if (!stack) {
    return [];
  }
  const frames = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") || line.includes("@"));
  const external: string[] = [];
  let skipping = true;
  for (const frame of frames) {
    if (
      skipping &&
      /captureStackTrace|createRecord_|spySubscribe_|Observable\.subscribe/.test(
        frame,
      )
    ) {
      continue;
    }
    skipping = false;
    external.push(frame);
    if (external.length >= 10) {
      break;
    }
  }
  return external;
}
