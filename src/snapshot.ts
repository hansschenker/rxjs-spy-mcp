import { matches } from "./match";
import type { Match } from "./match";
import { isClosed } from "./record";
import type { SubscriptionRecord } from "./record";
import { toSerializable } from "./serialize";
import type { SerializeOptions } from "./serialize";

export interface SnapshotNode {
  active: boolean;
  closedAt?: number;
  completed: boolean;
  error?: unknown;
  errored: boolean;
  flattened: boolean;
  id: number;
  latestValues?: unknown[];
  matched?: boolean;
  nextCount: number;
  observableId: number;
  observableType: string;
  sources: SnapshotNode[];
  stackTrace?: string[];
  subscribedAt: number;
  tag?: string;
  unsubscribed: boolean;
}

export interface SnapshotOptions {
  includeStackTraces?: boolean;
  includeValues?: boolean;
  limit?: number;
  match?: Match;
  serialize?: SerializeOptions;
}

export interface SnapshotResult {
  nodeCount: number;
  roots: SnapshotNode[];
  timestamp: number;
  truncated: boolean;
}

/**
 * Builds a JSON-safe tree of the current subscription graph. Roots are
 * records with no sink (i.e. the application's own subscribe calls); each
 * node nests its upstream sources. With `match`, only root subtrees that
 * contain a matching record are included and matching nodes are marked.
 */
export function snapshot(
  records: SubscriptionRecord[],
  options: SnapshotOptions = {},
): SnapshotResult {
  const {
    includeStackTraces = true,
    includeValues = true,
    limit = 200,
    match,
  } = options;
  const roots = records.filter((record) => record.sink === undefined);
  const subtreeMatches = (record: SubscriptionRecord): boolean =>
    match === undefined ||
    matches(record, match) ||
    record.sources.some(subtreeMatches);
  let nodeCount = 0;
  let truncated = false;
  const toNode = (record: SubscriptionRecord): SnapshotNode | undefined => {
    if (nodeCount >= limit) {
      truncated = true;
      return undefined;
    }
    nodeCount += 1;
    const node: SnapshotNode = {
      active: !isClosed(record),
      closedAt: record.closedAt,
      completed: record.completed,
      errored: record.errored,
      flattened: record.flattened,
      id: record.id,
      nextCount: record.nextCount,
      observableId: record.observableId,
      observableType: record.observableType,
      sources: [],
      subscribedAt: record.subscribedAt,
      tag: record.tag,
      unsubscribed: record.unsubscribed,
    };
    if (match !== undefined && matches(record, match)) {
      node.matched = true;
    }
    if (record.errored) {
      node.error = toSerializable(record.error, options.serialize);
    }
    if (includeValues) {
      node.latestValues = record.latestValues.map((value) =>
        toSerializable(value, options.serialize),
      );
    }
    if (includeStackTraces && record.stackTrace) {
      node.stackTrace = record.stackTrace;
    }
    for (const source of record.sources) {
      const child = toNode(source);
      if (child) {
        node.sources.push(child);
      }
    }
    return node;
  };
  const rootNodes: SnapshotNode[] = [];
  for (const root of roots) {
    if (!subtreeMatches(root)) {
      continue;
    }
    const node = toNode(root);
    if (node) {
      rootNodes.push(node);
    }
  }
  return { nodeCount, roots: rootNodes, timestamp: Date.now(), truncated };
}
