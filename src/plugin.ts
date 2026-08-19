import type { SubscriptionRecord } from "./record";

/**
 * The plugin seam. All hooks are optional; deferred features (pause decks,
 * cycle detection, stats) plug in here without touching the core.
 */
export interface SpyPlugin {
  readonly name: string;
  afterComplete?(record: SubscriptionRecord): void;
  afterError?(record: SubscriptionRecord, error: unknown): void;
  afterNext?(record: SubscriptionRecord, value: unknown): void;
  afterSubscribe?(record: SubscriptionRecord): void;
  afterUnsubscribe?(record: SubscriptionRecord): void;
  beforeComplete?(record: SubscriptionRecord): void;
  beforeError?(record: SubscriptionRecord, error: unknown): void;
  beforeNext?(record: SubscriptionRecord, value: unknown): void;
  beforeSubscribe?(record: SubscriptionRecord): void;
  beforeUnsubscribe?(record: SubscriptionRecord): void;
  teardown?(): void;
}
