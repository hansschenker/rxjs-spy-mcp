import { of } from "rxjs";
import { describe, expect, it } from "vitest";
import { tag } from "./operators";
import { toSerializable } from "./serialize";

describe("toSerializable", () => {
  it("passes through JSON-safe primitives", () => {
    expect(toSerializable(1)).toBe(1);
    expect(toSerializable("a")).toBe("a");
    expect(toSerializable(true)).toBe(true);
    expect(toSerializable(null)).toBe(null);
  });

  it("represents non-JSON primitives as strings", () => {
    expect(toSerializable(undefined)).toBe("[undefined]");
    expect(toSerializable(10n)).toBe("10n");
    expect(toSerializable(NaN)).toBe("NaN");
    expect(toSerializable(Infinity)).toBe("Infinity");
    expect(toSerializable(function named() {})).toBe("[Function: named]");
    expect(toSerializable(Symbol("s"))).toBe("Symbol(s)");
  });

  it("truncates long strings", () => {
    const long = "x".repeat(250);
    const result = toSerializable(long) as string;
    expect(result).toContain("(+50 chars)");
    expect(result.length).toBeLessThan(250);
  });

  it("marks circular references", () => {
    const target: Record<string, unknown> = {};
    target["self"] = target;
    expect(toSerializable(target)).toEqual({ self: "[Circular]" });
  });

  it("allows repeated (non-circular) references", () => {
    const shared = { value: 1 };
    expect(toSerializable({ a: shared, b: shared })).toEqual({
      a: { value: 1 },
      b: { value: 1 },
    });
  });

  it("limits depth", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const result = toSerializable(deep, { maxDepth: 2 });
    expect(JSON.stringify(result)).toContain("[Object");
  });

  it("caps arrays and objects", () => {
    const wide = Array.from({ length: 15 }, (_, index) => index);
    const result = toSerializable(wide, { maxArrayLength: 10 }) as unknown[];
    expect(result).toHaveLength(11);
    expect(result[10]).toContain("+5 more");
  });

  it("serializes errors compactly", () => {
    const result = toSerializable(new Error("boom")) as {
      message: string;
      name: string;
      stack?: string[];
    };
    expect(result.message).toBe("boom");
    expect(result.name).toBe("Error");
    expect(result.stack?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it("renders observables as references with tags", () => {
    const source = of(1).pipe(tag("nums"));
    expect(toSerializable(source)).toMatch(/^\[Observable #\d+ tag=nums\]$/);
  });

  it("redacts sensitive keys by default (case-insensitive substring)", () => {
    const result = toSerializable({
      ApiToken: "t",
      nested: { Authorization: "Bearer x", ok: 1 },
      password: "hunter2",
      username: "hans",
    });
    expect(result).toEqual({
      ApiToken: "[Redacted]",
      nested: { Authorization: "[Redacted]", ok: 1 },
      password: "[Redacted]",
      username: "hans",
    });
  });

  it("redacts keys, not values", () => {
    expect(toSerializable({ note: "my password is safe here" })).toEqual({
      note: "my password is safe here",
    });
  });

  it("supports custom redact keys and opt-out", () => {
    const custom = toSerializable(
      { password: "x", ssn: "123" },
      { redactKeys: ["ssn"] },
    );
    expect(custom).toEqual({ password: "x", ssn: "[Redacted]" });
    const off = toSerializable({ password: "x" }, { redactKeys: [] });
    expect(off).toEqual({ password: "x" });
  });

  it("always produces JSON.stringify-safe output", () => {
    const nasty: Record<string, unknown> = {
      date: new Date(0),
      fn: () => {},
      map: new Map([["k", "v"]]),
      regex: /a/g,
      set: new Set([1]),
    };
    nasty["cycle"] = nasty;
    expect(() => JSON.stringify(toSerializable(nasty))).not.toThrow();
  });
});
