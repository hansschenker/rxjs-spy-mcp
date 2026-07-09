import type {
  DebugFrame,
  RxjsSpyMcpApi,
  SchedulerTrace,
  SpyDiagnostics,
  StreamRecordSnapshot,
  StreamStatus,
  StreamSummary
} from './types';
import { makeSafeSnapshot, type SnapshotOptions } from './snapshot';

interface MutableStreamRecord {
  tag: string;
  status: StreamStatus;
  activeSubscriptions: Set<string>;
  totalSubscriptions: number;
  totalNotifications: number;
  history: DebugFrame[];
  selectedIndex: number;
  maxFrames: number;
}

const DEFAULT_MAX_FRAMES = 50;
const MAIN_STATE_TAG = 'main-app-state';
const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
let frameId = 0;
let subscriptionId = 0;

export function isSpyEnabled(): boolean {
  return typeof import.meta !== 'undefined' ? import.meta.env.DEV : true;
}

export class SpyRegistry implements RxjsSpyMcpApi {
  readonly version = '0.1.0';

  private readonly streams = new Map<string, MutableStreamRecord>();

  diagnose(): SpyDiagnostics {
    const mainStateStream = this.streams.get(MAIN_STATE_TAG);
    const streamTags = Array.from(this.streams.keys());
    const tips: string[] = [];

    if (!mainStateStream) {
      tips.push('No main-app-state stream exists yet. Confirm the page loaded the current bundle and that main.ts subscribed to runtime.appState$.');
    }

    if (mainStateStream && mainStateStream.history.length === 0) {
      tips.push('main-app-state exists but has no frames. Refresh the page and check the browser console for runtime errors.');
    }

    if (streamTags.length === 0) {
      tips.push('No streams are tracked. Pull the latest repo changes, run npm install, then run npm run dev and hard-refresh the browser.');
    }

    tips.push('Use the exact global name: window.__RXJS_SPY_MCP__ with two underscores before and after RXJS_SPY_MCP.');
    tips.push('The demo should record an INIT mvu-transition immediately after the page renders.');

    return {
      version: this.version,
      spyEnabled: isSpyEnabled(),
      streamCount: this.streams.size,
      streamTags,
      expectedMainStateTag: MAIN_STATE_TAG,
      hasMainStateStream: Boolean(mainStateStream),
      mainStateHistorySize: mainStateStream?.history.length ?? 0,
      documentReadyState: typeof document !== 'undefined' ? document.readyState : undefined,
      location: typeof window !== 'undefined' ? window.location.href : undefined,
      tips
    };
  }

  ensureStream(tag: string, maxFrames = DEFAULT_MAX_FRAMES): MutableStreamRecord {
    const existing = this.streams.get(tag);
    if (existing) {
      existing.maxFrames = Math.max(existing.maxFrames, maxFrames);
      return existing;
    }

    const record: MutableStreamRecord = {
      tag,
      status: 'idle',
      activeSubscriptions: new Set<string>(),
      totalSubscriptions: 0,
      totalNotifications: 0,
      history: [],
      selectedIndex: -1,
      maxFrames
    };

    this.streams.set(tag, record);
    return record;
  }

  startSubscription(tag: string, maxFrames = DEFAULT_MAX_FRAMES): string {
    const record = this.ensureStream(tag, maxFrames);
    const id = `${tag}#${++subscriptionId}`;
    record.activeSubscriptions.add(id);
    record.totalSubscriptions += 1;
    record.status = 'active';
    return id;
  }

  recordNext(tag: string, subscriptionId: string, value: unknown, options?: SnapshotOptions, scheduler?: SchedulerTrace): void {
    this.pushFrame(tag, {
      tag,
      subscriptionId,
      kind: 'next',
      value: makeSafeSnapshot(value, options),
      scheduler
    });
  }

  recordError(tag: string, subscriptionId: string, error: unknown, options?: SnapshotOptions, scheduler?: SchedulerTrace): void {
    const record = this.ensureStream(tag);
    record.status = 'errored';
    this.pushFrame(tag, {
      tag,
      subscriptionId,
      kind: 'error',
      error: makeSafeSnapshot(error, options),
      scheduler
    });
  }

  recordComplete(tag: string, subscriptionId: string, scheduler?: SchedulerTrace): void {
    const record = this.ensureStream(tag);
    record.status = 'completed';
    this.pushFrame(tag, {
      tag,
      subscriptionId,
      kind: 'complete',
      scheduler
    });
  }

  recordUnsubscribe(tag: string, subscriptionId: string): void {
    const record = this.ensureStream(tag);
    record.activeSubscriptions.delete(subscriptionId);

    if (record.activeSubscriptions.size === 0 && record.status !== 'completed' && record.status !== 'errored') {
      record.status = 'unsubscribed';
    }

    this.pushFrame(tag, {
      tag,
      subscriptionId,
      kind: 'unsubscribe'
    });
  }

  endSubscription(tag: string, subscriptionId: string): void {
    const record = this.ensureStream(tag);
    record.activeSubscriptions.delete(subscriptionId);
  }

  recordMvuTransition<Message, Model>(
    tag: string,
    subscriptionId: string,
    action: Message,
    resultingState: Model,
    options?: SnapshotOptions,
    scheduler?: SchedulerTrace
  ): void {
    this.pushFrame(tag, {
      tag,
      subscriptionId,
      kind: 'mvu-transition',
      action: makeSafeSnapshot(action, options),
      resultingState: makeSafeSnapshot(resultingState, options),
      scheduler
    });
  }

  listStreams(): StreamSummary[] {
    return Array.from(this.streams.values()).map(record => this.toSummary(record));
  }

  inspectStream(tag: string): StreamRecordSnapshot | null {
    const record = this.streams.get(tag);
    if (!record) return null;

    return {
      ...this.toSummary(record),
      history: [...record.history]
    };
  }

  getTimeline(tag: string, limit = DEFAULT_MAX_FRAMES): DebugFrame[] {
    const record = this.streams.get(tag);
    if (!record) return [];
    return record.history.slice(-limit);
  }

  selectFrame(tag: string, index: number): boolean {
    const record = this.streams.get(tag);
    if (!record || index < 0 || index >= record.history.length) return false;
    record.selectedIndex = index;
    return true;
  }

  clearStream(tag: string): boolean {
    const record = this.streams.get(tag);
    if (!record) return false;
    record.history = [];
    record.selectedIndex = -1;
    record.totalNotifications = 0;
    return true;
  }

  clearAll(): void {
    for (const record of this.streams.values()) {
      record.history = [];
      record.selectedIndex = -1;
      record.totalNotifications = 0;
    }
  }

  private pushFrame(tag: string, partial: Omit<DebugFrame, 'id' | 'observedAt' | 'observedAtIso' | 'elapsedMs'>): void {
    const record = this.ensureStream(tag);
    const observedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const frame: DebugFrame = {
      ...partial,
      id: ++frameId,
      observedAt,
      observedAtIso: new Date().toISOString(),
      elapsedMs: Math.round((observedAt - startedAt) * 100) / 100
    };

    record.history.push(frame);
    record.totalNotifications += 1;

    if (record.history.length > record.maxFrames) {
      record.history.shift();
    }

    record.selectedIndex = record.history.length - 1;
  }

  private toSummary(record: MutableStreamRecord): StreamSummary {
    return {
      tag: record.tag,
      status: record.status,
      subscriberCount: record.activeSubscriptions.size,
      totalSubscriptions: record.totalSubscriptions,
      totalNotifications: record.totalNotifications,
      historySize: record.history.length,
      selectedIndex: record.selectedIndex,
      lastFrame: record.history.at(-1)
    };
  }
}

export const registry = new SpyRegistry();

export function installRxjsSpyMcpGlobal(): void {
  if (!isSpyEnabled()) return;
  if (typeof window === 'undefined') return;

  window.__RXJS_SPY_MCP__ = registry;
  globalThis.__RXJS_SPY_MCP__ = registry;
}
