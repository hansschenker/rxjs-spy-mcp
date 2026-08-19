import type { Observable, Subscription } from "rxjs";

/**
 * One record per observed subscribe call. Graph relationships: `sink` is the
 * downstream record whose subscribe (or next, when `flattened`) caused this
 * one; `sources` are the upstream records observed while this record's
 * subscribe was on the stack.
 */
export interface SubscriptionRecord {
  closedAt: number | undefined;
  completed: boolean;
  error: unknown;
  errored: boolean;
  flattened: boolean;
  id: number;
  latestValues: unknown[];
  nextCount: number;
  observable: Observable<unknown>;
  observableId: number;
  observableType: string;
  rootSink: SubscriptionRecord | undefined;
  sink: SubscriptionRecord | undefined;
  sources: SubscriptionRecord[];
  stackTrace: string[] | undefined;
  subscribedAt: number;
  subscription: Subscription | undefined;
  tag: string | undefined;
  tick: number;
  unsubscribed: boolean;
}

export function isClosed(record: SubscriptionRecord): boolean {
  return record.completed || record.errored || record.unsubscribed;
}
