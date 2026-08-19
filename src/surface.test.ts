import { Subject } from "rxjs";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "./operators";
import { create } from "./spy";
import type { Spy } from "./spy";
import type {
  HelpResult,
  LogsResult,
  SpySurface,
  StatusResult,
  TagsResult,
} from "./surface";

const GLOBAL = "__RXJS_SPY_TEST__";

function getSurface(): SpySurface {
  const surface = (globalThis as Record<string, unknown>)[GLOBAL];
  expect(surface).toBeDefined();
  return surface as SpySurface;
}

describe("SpySurface", () => {
  let spy: Spy | undefined;

  afterEach(() => {
    spy?.teardown();
    spy = undefined;
  });

  it("installs on globalThis and uninstalls on teardown", () => {
    spy = create({ global: GLOBAL });
    expect((globalThis as Record<string, unknown>)[GLOBAL]).toBeDefined();
    spy.teardown();
    expect((globalThis as Record<string, unknown>)[GLOBAL]).toBeUndefined();
  });

  it("reports status with counts and tags", () => {
    spy = create({ global: GLOBAL });
    const subject = new Subject<number>();
    subject.pipe(tag("numbers")).subscribe();
    subject.next(1);
    const status = getSurface().status() as StatusResult;
    expect(status.spying).toBe(true);
    expect(status.counts.active).toBeGreaterThan(0);
    expect(status.tags).toContain("numbers");
    expect(() => JSON.stringify(status)).not.toThrow();
  });

  it("produces a JSON-safe filtered snapshot", () => {
    spy = create({ global: GLOBAL });
    const numbers = new Subject<number>();
    const letters = new Subject<string>();
    numbers.pipe(tag("numbers")).subscribe();
    letters.pipe(tag("letters")).subscribe();
    numbers.next(1);
    numbers.next(2);
    const surface = getSurface();
    const result = surface.snapshot({ match: "numbers" });
    const json = JSON.parse(JSON.stringify(result)) as {
      roots: { tag?: string; latestValues?: unknown[]; matched?: boolean }[];
    };
    expect(json.roots).toHaveLength(1);
    expect(json.roots[0].tag).toBe("numbers");
    expect(json.roots[0].matched).toBe(true);
    expect(json.roots[0].latestValues).toEqual([1, 2]);
  });

  it("supports regex matches via /exp/ strings", () => {
    spy = create({ global: GLOBAL });
    new Subject<number>().pipe(tag("search.results")).subscribe();
    const result = getSurface().snapshot({ match: "/^search/" }) as {
      roots: unknown[];
    };
    expect(result.roots).toHaveLength(1);
  });

  it("returns an error envelope instead of throwing", () => {
    spy = create({ global: GLOBAL });
    const result = getSurface().snapshot({ match: "/[/" });
    expect(result).toHaveProperty("error.message");
  });

  it("lists tags with counts", () => {
    spy = create({ global: GLOBAL });
    const subject = new Subject<number>();
    subject.pipe(tag("numbers")).subscribe();
    subject.pipe(tag("numbers")).subscribe();
    subject.next(7);
    const { tags } = getSurface().listTags() as TagsResult;
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe("numbers");
    expect(tags[0].total).toBe(2);
    expect(tags[0].totalNext).toBe(2);
  });

  it("supports incremental log polling", () => {
    spy = create({ global: GLOBAL, logger: { log: () => {} } });
    const surface = getSurface();
    const handle = surface.log("numbers") as { logId: number };
    expect(handle.logId).toBeGreaterThan(0);
    const subject = new Subject<number>();
    subject.pipe(tag("numbers")).subscribe();
    subject.next(42);
    const first = surface.logs({ sinceIndex: 0 }) as LogsResult;
    expect(first.entries.map((entry) => entry.notification)).toEqual([
      "subscribe",
      "next",
    ]);
    const second = surface.logs({ sinceIndex: first.nextIndex }) as LogsResult;
    expect(second.entries).toHaveLength(0);
    expect(surface.unlog()).toEqual({ removed: 1 });
  });

  it("describes every surface method in help()", () => {
    spy = create({ global: GLOBAL });
    const surface = getSurface();
    const help = surface.help() as HelpResult;
    expect(help.name).toBe("rxjs-spy");
    expect(help.methods.length).toBeGreaterThan(5);
    for (const method of help.methods) {
      expect(
        typeof (surface as unknown as Record<string, unknown>)[method.name],
      ).toBe("function");
    }
    const names = help.methods.map((method) => method.name).sort();
    const surfaceKeys = Object.keys(surface).sort();
    expect(names).toEqual(surfaceKeys);
  });

  it("tears down via the surface", () => {
    spy = create({ global: GLOBAL });
    const surface = getSurface();
    expect(surface.teardown()).toEqual({ torndown: true });
    expect((globalThis as Record<string, unknown>)[GLOBAL]).toBeUndefined();
  });
});
