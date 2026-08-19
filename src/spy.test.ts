import { config, merge, mergeMap, Observable, of, Subject, switchMap, throwError } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hide, tag } from "./operators";
import type { SpyPlugin } from "./plugin";
import { create } from "./spy";
import type { Spy } from "./spy";

describe("Spy", () => {
  let spy: Spy | undefined;

  afterEach(() => {
    spy?.teardown();
    spy = undefined;
    vi.useRealTimers();
  });

  it("throws when created twice", () => {
    spy = create({ installGlobal: false });
    expect(() => create({ installGlobal: false })).toThrow(/Already spying/);
  });

  it("patches and restores Observable.prototype.subscribe", () => {
    const original = Observable.prototype.subscribe;
    spy = create({ installGlobal: false });
    expect(Observable.prototype.subscribe).not.toBe(original);
    spy.teardown();
    expect(Observable.prototype.subscribe).toBe(original);
  });

  it("tracks subscriptions, values, and explicit unsubscribes", () => {
    spy = create({ installGlobal: false });
    const subject = new Subject<number>();
    const subscription = subject.pipe(tag("numbers")).subscribe();
    subject.next(1);
    subject.next(2);
    const record = spy.records().find((r) => r.tag === "numbers");
    expect(record).toBeDefined();
    expect(record?.nextCount).toBe(2);
    expect(record?.latestValues).toEqual([1, 2]);
    expect(record?.unsubscribed).toBe(false);
    subscription.unsubscribe();
    expect(record?.unsubscribed).toBe(true);
    expect(record?.closedAt).toBeDefined();
  });

  it("keeps only keptValues latest values", () => {
    spy = create({ installGlobal: false, keptValues: 2 });
    const subject = new Subject<number>();
    subject.pipe(tag("numbers")).subscribe();
    subject.next(1);
    subject.next(2);
    subject.next(3);
    const record = spy.records().find((r) => r.tag === "numbers");
    expect(record?.latestValues).toEqual([2, 3]);
    expect(record?.nextCount).toBe(3);
  });

  it("marks completion and error state", () => {
    spy = create({ installGlobal: false });
    of(1).pipe(tag("done")).subscribe();
    throwError(() => new Error("boom"))
      .pipe(tag("bad"))
      .subscribe({ error: () => {} });
    const done = spy.records().find((r) => r.tag === "done");
    const bad = spy.records().find((r) => r.tag === "bad");
    expect(done?.completed).toBe(true);
    expect(bad?.errored).toBe(true);
    expect((bad?.error as Error).message).toBe("boom");
  });

  it("preserves unhandled-error reporting when no error handler is given", async () => {
    const seen: unknown[] = [];
    config.onUnhandledError = (error) => seen.push(error);
    try {
      spy = create({ installGlobal: false });
      throwError(() => new Error("boom"))
        .pipe(tag("bad"))
        .subscribe();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(seen).toHaveLength(1);
      expect((seen[0] as Error).message).toBe("boom");
    } finally {
      config.onUnhandledError = null;
    }
  });

  it("ignores hidden observables and their subtree", () => {
    spy = create({ installGlobal: false });
    const subject = new Subject<number>();
    subject.pipe(tag("inner"), hide()).subscribe();
    subject.next(1);
    expect(spy.records()).toHaveLength(0);
  });

  it("links sources to sinks in the graph", () => {
    spy = create({ installGlobal: false });
    merge(of(1).pipe(tag("a")), of(2).pipe(tag("b")))
      .pipe(tag("m"))
      .subscribe();
    const records = spy.records();
    const root = records.find((r) => r.sink === undefined);
    expect(root?.tag).toBe("m");
    const a = records.find((r) => r.tag === "a");
    const b = records.find((r) => r.tag === "b");
    expect(a?.rootSink).toBe(root);
    expect(b?.rootSink).toBe(root);
  });

  it("marks flattened (inner) subscriptions", () => {
    spy = create({ installGlobal: false });
    const subject = new Subject<number>();
    subject
      .pipe(mergeMap((value) => of(value).pipe(tag("inner"))))
      .subscribe();
    subject.next(1);
    const inner = spy.records().find((r) => r.tag === "inner");
    expect(inner).toBeDefined();
    expect(inner?.flattened).toBe(true);
    expect(inner?.rootSink?.sink).toBeUndefined();
  });

  it("propagates operator-driven unsubscription to the source (switchMap)", () => {
    spy = create({ installGlobal: false });
    const outer = new Subject<number>();
    const inners: Subject<number>[] = [];
    outer
      .pipe(
        switchMap(() => {
          const inner = new Subject<number>();
          inners.push(inner);
          return inner.pipe(tag("inner"));
        }),
      )
      .subscribe();
    outer.next(1);
    outer.next(2);
    // switchMap unsubscribes its own inner Subscriber directly; the source
    // subject must be released and the record marked unsubscribed.
    expect(inners[0].observed).toBe(false);
    expect(inners[1].observed).toBe(true);
    const records = spy.records().filter((r) => r.tag === "inner");
    expect(records).toHaveLength(2);
    expect(records[0].unsubscribed).toBe(true);
    expect(records[1].unsubscribed).toBe(false);
  });

  it("notifies plugins in order", () => {
    spy = create({ installGlobal: false });
    const hooks: string[] = [];
    const plugin: SpyPlugin = {
      afterComplete: () => hooks.push("afterComplete"),
      afterNext: () => hooks.push("afterNext"),
      afterSubscribe: () => hooks.push("afterSubscribe"),
      beforeComplete: () => hooks.push("beforeComplete"),
      beforeNext: () => hooks.push("beforeNext"),
      beforeSubscribe: () => hooks.push("beforeSubscribe"),
      name: "order",
    };
    spy.plug(plugin);
    of(1).pipe(hide()).subscribe();
    of(1).subscribe();
    expect(hooks).toEqual([
      "beforeSubscribe",
      "beforeNext",
      "afterNext",
      "beforeComplete",
      "afterComplete",
      "afterSubscribe",
    ]);
  });

  it("fires unsubscribe hooks once and not after terminal notifications", () => {
    spy = create({ installGlobal: false });
    const hooks: string[] = [];
    spy.plug({
      afterUnsubscribe: () => hooks.push("afterUnsubscribe"),
      beforeUnsubscribe: () => hooks.push("beforeUnsubscribe"),
      name: "unsub",
    });
    of(1).subscribe();
    expect(hooks).toEqual([]);
    const subject = new Subject<number>();
    const subscription = subject.subscribe();
    subscription.unsubscribe();
    subscription.unsubscribe();
    expect(hooks).toEqual(["beforeUnsubscribe", "afterUnsubscribe"]);
  });

  it("survives a throwing plugin", () => {
    const warnings: unknown[][] = [];
    spy = create({
      installGlobal: false,
      logger: { log: () => {}, warn: (...args) => warnings.push(args) },
    });
    spy.plug({
      beforeNext: () => {
        throw new Error("plugin boom");
      },
      name: "broken",
    });
    const values: number[] = [];
    of(1).subscribe((value) => values.push(value));
    expect(values).toEqual([1]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("flushes closed records immediately with force", () => {
    spy = create({ installGlobal: false });
    of(1).pipe(tag("done")).subscribe();
    const subject = new Subject<number>();
    subject.pipe(tag("live")).subscribe();
    expect(spy.records().length).toBeGreaterThan(0);
    spy.flush(true);
    const tags = spy.records().map((r) => r.tag);
    expect(tags).toContain("live");
    expect(tags).not.toContain("done");
  });

  it("flushes closed records only after keptDuration", () => {
    vi.useFakeTimers();
    spy = create({ installGlobal: false, keptDuration: 1000 });
    of(1).pipe(tag("done")).subscribe();
    expect(spy.flush()).toBe(0);
    vi.advanceTimersByTime(1001);
    expect(spy.flush()).toBeGreaterThan(0);
    expect(spy.records()).toHaveLength(0);
  });

  it("buffers and logs matching notifications", () => {
    const messages: unknown[][] = [];
    spy = create({
      installGlobal: false,
      logger: { log: (...args) => messages.push(args) },
    });
    const handle = spy.log("numbers");
    const subject = new Subject<number>();
    subject.pipe(tag("numbers")).subscribe();
    subject.next(42);
    const { entries, nextIndex } = spy.logEntries();
    expect(entries.map((entry) => entry.notification)).toEqual([
      "subscribe",
      "next",
    ]);
    expect(entries[1].value).toBe(42);
    expect(entries[1].tag).toBe("numbers");
    const firstArgs = messages.map((args) => String(args[0]));
    expect(firstArgs).toContain("[rxjs-spy] S numbers");
    expect(firstArgs).toContain("[rxjs-spy] N numbers");
    expect(spy.unlog(handle.logId)).toBe(1);
    subject.next(43);
    expect(spy.logEntries().nextIndex).toBe(nextIndex);
  });

  it("does not log non-matching notifications", () => {
    spy = create({ installGlobal: false, logger: { log: () => {} } });
    spy.log("numbers");
    const subject = new Subject<number>();
    subject.pipe(tag("letters")).subscribe();
    subject.next(1);
    expect(spy.logEntries().entries).toHaveLength(0);
  });
});
