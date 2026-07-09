export type StreamStatus = 'idle' | 'active' | 'completed' | 'errored' | 'unsubscribed';

export type DebugFrameKind =
  | 'next'
  | 'error'
  | 'complete'
  | 'unsubscribe'
  | 'mvu-transition';

export type SchedulerName =
  | 'queue'
  | 'asap'
  | 'async'
  | 'animationFrame'
  | 'virtual'
  | 'unknown';

export interface SchedulerTrace {
  name: SchedulerName;
  scheduledAt?: number;
  dueAt?: number;
  executedAt?: number;
  delayMs?: number;
  driftMs?: number;
}

export interface DebugFrame {
  id: number;
  tag: string;
  kind: DebugFrameKind;
  subscriptionId?: string;
  observedAt: number;
  observedAtIso: string;
  elapsedMs: number;
  scheduler?: SchedulerTrace;
  value?: unknown;
  error?: unknown;
  action?: unknown;
  resultingState?: unknown;
}

export interface StreamSummary {
  tag: string;
  status: StreamStatus;
  subscriberCount: number;
  totalSubscriptions: number;
  totalNotifications: number;
  historySize: number;
  selectedIndex: number;
  lastFrame?: DebugFrame;
}

export interface StreamRecordSnapshot extends StreamSummary {
  history: DebugFrame[];
}

export interface RxjsSpyMcpApi {
  readonly version: string;
  listStreams(): StreamSummary[];
  inspectStream(tag: string): StreamRecordSnapshot | null;
  getTimeline(tag: string, limit?: number): DebugFrame[];
  selectFrame(tag: string, index: number): boolean;
  clearStream(tag: string): boolean;
  clearAll(): void;
}

declare global {
  interface Window {
    __RXJS_SPY_MCP__?: RxjsSpyMcpApi;
    jumpToStep?: (index: number) => void;
  }

  // Allows console access through globalThis.__RXJS_SPY_MCP__ as well as window.__RXJS_SPY_MCP__.
  // eslint-disable-next-line no-var
  var __RXJS_SPY_MCP__: RxjsSpyMcpApi | undefined;
}

export {};
