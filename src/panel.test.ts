// @vitest-environment happy-dom
import { Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "./operators";
import { mountDebugPanel } from "./panel";
import { create } from "./spy";
import type { Spy } from "./spy";

describe("mountDebugPanel", () => {
  let spy: Spy | undefined;

  afterEach(() => {
    spy?.teardown();
    spy = undefined;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("renders trace lines and status, and cleans up on unmount", () => {
    vi.useFakeTimers();
    spy = create({ installGlobal: false, logger: { log: () => {} } });
    const unmount = mountDebugPanel(spy);
    expect(spy.logs()).toHaveLength(1);
    const subject = new Subject<number>();
    subject.pipe(tag("numbers")).subscribe();
    subject.next(42);
    vi.advanceTimersByTime(600);
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("N numbers");
    expect(pre?.textContent).toContain("42");
    const status = document.querySelector("span");
    expect(status?.textContent).toContain("active");
    unmount();
    expect(document.body.innerHTML).toBe("");
    expect(spy.logs()).toHaveLength(0);
  });

  it("renders into a provided container without auto-logging when disabled", () => {
    spy = create({ installGlobal: false, logger: { log: () => {} } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const unmount = mountDebugPanel(spy, { container: host, startLog: false });
    expect(spy.logs()).toHaveLength(0);
    expect(host.querySelector("pre")).not.toBeNull();
    unmount();
    expect(host.querySelector("pre")).toBeNull();
  });

  it("shows only entries recorded after mounting", () => {
    vi.useFakeTimers();
    spy = create({ installGlobal: false, logger: { log: () => {} } });
    spy.log("early", { console: false });
    const early = new Subject<number>();
    early.pipe(tag("early")).subscribe();
    early.next(1);
    const unmount = mountDebugPanel(spy);
    const late = new Subject<number>();
    late.pipe(tag("late")).subscribe();
    late.next(2);
    vi.advanceTimersByTime(600);
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("late");
    expect(pre?.textContent).not.toContain("early");
    unmount();
  });
});
