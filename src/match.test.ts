import { of } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import { matches, matchToString, parseMatch } from "./match";
import type { SubscriptionRecord } from "./record";

function makeRecord(
  partial: Partial<SubscriptionRecord> & { observable: Observable<unknown> },
): SubscriptionRecord {
  return {
    closedAt: undefined,
    completed: false,
    error: undefined,
    errored: false,
    flattened: false,
    id: 7,
    latestValues: [],
    nextCount: 0,
    observableId: 42,
    observableType: "Observable",
    rootSink: undefined,
    sink: undefined,
    sources: [],
    stackTrace: undefined,
    subscribedAt: 0,
    subscription: undefined,
    tag: undefined,
    tick: 0,
    unsubscribed: false,
    ...partial,
  };
}

describe("matches", () => {
  const observable = of(1);

  it("matches a string against the tag", () => {
    const record = makeRecord({ observable, tag: "people" });
    expect(matches(record, "people")).toBe(true);
    expect(matches(record, "other")).toBe(false);
  });

  it("matches a string against observable and record ids", () => {
    const record = makeRecord({ observable });
    expect(matches(record, "42")).toBe(true);
    expect(matches(record, "7")).toBe(true);
    expect(matches(record, "8")).toBe(false);
  });

  it("matches a RegExp against the tag only", () => {
    expect(matches(makeRecord({ observable, tag: "people" }), /^peo/)).toBe(
      true,
    );
    expect(matches(makeRecord({ observable }), /.*/)).toBe(false);
  });

  it("matches a predicate", () => {
    const record = makeRecord({ observable, tag: "people" });
    expect(matches(record, (tag) => tag === "people")).toBe(true);
    expect(matches(record, (_, source) => source === observable)).toBe(true);
  });

  it("matches an observable by identity", () => {
    const record = makeRecord({ observable });
    expect(matches(record, observable)).toBe(true);
    expect(matches(record, of(2))).toBe(false);
  });
});

describe("parseMatch", () => {
  it("parses /exp/flags into a RegExp", () => {
    const match = parseMatch("/^peo/i");
    expect(match).toBeInstanceOf(RegExp);
    expect((match as RegExp).source).toBe("^peo");
    expect((match as RegExp).flags).toBe("i");
  });

  it("leaves plain strings alone", () => {
    expect(parseMatch("people")).toBe("people");
  });
});

describe("matchToString", () => {
  it("renders all match kinds", () => {
    expect(matchToString("people")).toBe("people");
    expect(matchToString(/a/)).toBe("/a/");
    expect(matchToString(() => true)).toBe("[Function]");
    expect(matchToString(of(1))).toBe("[Observable]");
  });
});
