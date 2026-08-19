import type { LogEntry } from "./log-plugin";
import { NOTIFICATION_LETTERS } from "./log-plugin";
import { isClosed } from "./record";
import type { Spy } from "./spy";

export interface DebugPanelOptions {
  /** Element to render into. When omitted, a floating bottom-right overlay is appended to <body>. */
  container?: HTMLElement;
  /** Also write matching notifications to the console. Default: false. */
  console?: boolean;
  /** Poll interval for the log ring buffer, in milliseconds. Default: 500. */
  intervalMs?: number;
  /** Maximum characters kept in the trace. Default: 20000. */
  maxChars?: number;
  /** Automatically log all tagged streams into the panel. Default: true. */
  startLog?: boolean;
}

/**
 * Mounts a small self-contained debug panel that mirrors the spy's output
 * inside the page itself - status line plus the live S/N/E/C/U trace - so
 * no DevTools console and no MCP agent are needed to watch streams.
 * Inline-styled, no CSS dependencies. Returns an unmount function that
 * removes the panel and stops the log it started.
 *
 * Intended for dev builds only:
 *
 *   const spy = create();
 *   if (import.meta.env.DEV) mountDebugPanel(spy);
 */
export function mountDebugPanel(
  spy: Spy,
  options: DebugPanelOptions = {},
): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  const intervalMs = options.intervalMs ?? 500;
  const maxChars = options.maxChars ?? 20_000;
  const floating = options.container === undefined;

  const root = document.createElement("div");
  root.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "background:#1e1e1e",
    "color:#d4d4d4",
    "font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace",
    "border-radius:8px",
    "overflow:hidden",
    floating
      ? "position:fixed;right:12px;bottom:12px;width:540px;max-height:300px;z-index:2147483000;box-shadow:0 4px 24px rgba(0,0,0,.4)"
      : "width:100%;max-height:300px",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:5px 10px;background:#2d2d2d;flex:none";
  const status = document.createElement("span");
  status.style.cssText = "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  const clearButton = document.createElement("button");
  clearButton.textContent = "clear";
  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  for (const button of [clearButton, closeButton]) {
    button.style.cssText =
      "background:#3d3d3d;border:0;border-radius:4px;color:#d4d4d4;cursor:pointer;font:inherit;padding:1px 8px";
  }
  header.append(status, clearButton, closeButton);

  const pre = document.createElement("pre");
  pre.style.cssText =
    "flex:1;margin:0;padding:6px 10px;overflow:auto;white-space:pre";
  pre.textContent = "(waiting for notifications)";

  root.append(header, pre);
  (options.container ?? document.body).appendChild(root);

  let logId: number | undefined;
  if (options.startLog !== false) {
    logId = spy.log((streamTag) => streamTag !== undefined, {
      console: options.console === true,
    }).logId;
  }

  // Start at the buffer's current position: the panel shows what happens
  // from mount onward, not entries recorded by earlier logs.
  let sinceIndex = spy.logEntries(0, 0).nextIndex;
  const render = (): void => {
    const { entries, nextIndex } = spy.logEntries(sinceIndex, 200);
    sinceIndex = nextIndex;
    if (entries.length > 0) {
      const lines = entries.map(formatEntry);
      const previous = pre.textContent?.startsWith("(waiting")
        ? ""
        : (pre.textContent ?? "");
      pre.textContent = `${lines.reverse().join("\n")}\n${previous}`.slice(
        0,
        maxChars,
      );
    }
    const records = spy.records();
    const active = records.filter((record) => !isClosed(record)).length;
    status.textContent = `rxjs-spy ${spy.version} · tick ${spy.tick} · ${active} active / ${records.length} records`;
  };
  const timer = setInterval(render, intervalMs);
  render();

  clearButton.addEventListener("click", () => {
    pre.textContent = "(cleared)";
  });

  const unmount = (): void => {
    clearInterval(timer);
    if (logId !== undefined) {
      spy.unlog(logId);
    }
    root.remove();
  };
  closeButton.addEventListener("click", unmount);
  return unmount;
}

function formatEntry(entry: LogEntry & { index: number }): string {
  const detail =
    entry.notification === "next"
      ? ` ${JSON.stringify(entry.value)}`
      : entry.notification === "error"
        ? ` ${JSON.stringify(entry.error)}`
        : "";
  return `${String(entry.index).padStart(4)} ${NOTIFICATION_LETTERS[entry.notification]} ${(entry.tag ?? `#${entry.observableId}`).padEnd(20)}${detail}`;
}
