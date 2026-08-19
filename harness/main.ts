import { interval, map, mergeMap, Subject, switchMap, take, throwError, timer } from "rxjs";
import { create, isClosed } from "../src/index";
import type { SnapshotNode } from "../src/index";
import { tag } from "../src/operators";

const spy = create();

const output = document.querySelector<HTMLPreElement>("#output");

function write(line: string): void {
  if (output) {
    output.textContent = `${line}\n${output.textContent ?? ""}`.slice(0, 5000);
  }
}

write(`rxjs-spy ${spy.version} active — __RXJS_SPY__ installed`);

document.querySelector("#clock")?.addEventListener("click", () => {
  interval(1000)
    .pipe(tag("clock"), take(60))
    .subscribe((value) => write(`clock: ${value}`));
  write("clock started");
});

document.querySelector("#search")?.addEventListener("click", () => {
  const queries = new Subject<string>();
  queries
    .pipe(
      tag("search.query"),
      switchMap((query) =>
        timer(250).pipe(
          map(() => `results for "${query}"`),
          tag("search.results"),
        ),
      ),
      tag("search"),
    )
    .subscribe((result) => write(result));
  ["a", "ab", "abc"].forEach((query, index) => {
    setTimeout(() => queries.next(query), index * 400);
  });
  write("search simulation started");
});

document.querySelector("#failing")?.addEventListener("click", () => {
  timer(500)
    .pipe(
      mergeMap(() => throwError(() => new Error("boom"))),
      tag("failing"),
    )
    .subscribe({
      error: (error: unknown) => write(`failing errored: ${String(error)}`),
    });
  write("failing stream started");
});

// --- Debugger output panel -------------------------------------------------
// Renders the same data an MCP agent reads: the log ring buffer (polled
// incrementally with sinceIndex, like an agent would), spy status, and the
// snapshot tree. Plain DOM + timers only — no observables, so the panel
// itself never shows up in the spy's records.

const spyStatus = document.querySelector<HTMLElement>("#spy-status");
const spyLog = document.querySelector<HTMLPreElement>("#spy-log");
const spySnapshot = document.querySelector<HTMLPreElement>("#spy-snapshot");

document.querySelector("#spy-log-start")?.addEventListener("click", () => {
  const handle = spy.log((streamTag) => streamTag !== undefined);
  write(`spy: logging tagged streams (logId ${handle.logId})`);
});

document.querySelector("#spy-unlog")?.addEventListener("click", () => {
  write(`spy: removed ${spy.unlog()} log(s)`);
});

document.querySelector("#spy-snapshot-take")?.addEventListener("click", () => {
  if (!spySnapshot) {
    return;
  }
  const snap = spy.snapshot({ includeStackTraces: false });
  const lines: string[] = [];
  const walk = (node: SnapshotNode, depth: number): void => {
    const state = node.errored
      ? "ERRORED"
      : node.completed
        ? "completed"
        : node.unsubscribed
          ? "unsubscribed"
          : "ACTIVE";
    const values =
      node.latestValues && node.latestValues.length > 0
        ? ` values=${JSON.stringify(node.latestValues)}`
        : "";
    lines.push(
      `${"  ".repeat(depth)}${node.tag ?? `(${node.observableType})`} [${state}] next=${node.nextCount}${node.flattened ? " (flattened)" : ""}${values}`,
    );
    node.sources.forEach((source) => walk(source, depth + 1));
  };
  snap.roots.forEach((root) => walk(root, 0));
  spySnapshot.textContent = lines.length
    ? `snapshot @ tick ${spy.tick} (${snap.nodeCount} nodes)\n${lines.join("\n")}`
    : "(no records)";
});

let sinceIndex = 0;
let panelPrimed = false;
setInterval(() => {
  const { entries, nextIndex } = spy.logEntries(sinceIndex, 100);
  sinceIndex = nextIndex;
  if (spyLog && entries.length > 0) {
    const lines = entries.map((entry) => {
      const identity = entry.tag ?? `#${entry.observableId}`;
      const detail =
        entry.notification === "next"
          ? ` ${JSON.stringify(entry.value)}`
          : entry.notification === "error"
            ? ` ${JSON.stringify(entry.error)}`
            : "";
      return `${String(entry.index).padStart(3)} ${identity.padEnd(16)} ${entry.notification}${detail}`;
    });
    const previous = panelPrimed ? (spyLog.textContent ?? "") : "";
    panelPrimed = true;
    spyLog.textContent = `${lines.reverse().join("\n")}\n${previous}`.slice(0, 20_000);
  }
  if (spyStatus) {
    const records = spy.records();
    const active = records.filter((record) => !isClosed(record)).length;
    const logs = spy.logs().length;
    spyStatus.textContent = `tick ${spy.tick} · ${active} active / ${records.length} records · ${logs} active log(s) · ${nextIndex} log writes`;
  }
}, 500);
