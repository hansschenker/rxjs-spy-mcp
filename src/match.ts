import type { Observable } from "rxjs";
import type { SubscriptionRecord } from "./record";

export type MatchPredicate = (
  tag: string | undefined,
  observable: Observable<unknown>,
) => boolean;

export type Match = Observable<unknown> | RegExp | string | MatchPredicate;

export function matches(record: SubscriptionRecord, match: Match): boolean {
  if (typeof match === "string") {
    return (
      match === record.tag ||
      match === String(record.observableId) ||
      match === String(record.id)
    );
  }
  if (match instanceof RegExp) {
    return record.tag !== undefined && match.test(record.tag);
  }
  if (typeof match === "function") {
    return match(record.tag, record.observable);
  }
  return match === record.observable;
}

/**
 * Parses a string received over an MCP/console boundary into a Match:
 * "/exp/flags" becomes a RegExp; anything else matches as a literal
 * tag or id.
 */
export function parseMatch(match: string): Match {
  const result = /^\/(.*)\/([a-z]*)$/.exec(match);
  return result ? new RegExp(result[1], result[2]) : match;
}

export function matchToString(match: Match): string {
  if (typeof match === "string") {
    return match;
  }
  if (match instanceof RegExp) {
    return match.toString();
  }
  if (typeof match === "function") {
    return "[Function]";
  }
  return "[Observable]";
}
