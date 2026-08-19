import {
  debounceTime,
  fromEvent,
  map,
  merge,
  mergeMap,
  of,
  retry,
  Subject,
  switchMap,
  throwError,
  timer,
} from "rxjs";
import { create, NOTIFICATION_LETTERS } from "../src/index";
import { tag } from "../src/operators";

const spy = create();
spy.log((streamTag) => streamTag !== undefined);

const output = document.querySelector<HTMLPreElement>("#output");
const trace = document.querySelector<HTMLPreElement>("#trace");
const queryInput = document.querySelector<HTMLInputElement>("#query");

function write(target: HTMLPreElement | null, line: string): void {
  if (target) {
    target.textContent = `${line}\n${target.textContent ?? ""}`.slice(0, 20_000);
  }
}

// The pipeline under debug: keystrokes -> debounce -> flaky API with retry.
let attempt = 0;
const flakyApi = (query: string) =>
  timer(120).pipe(
    mergeMap(() =>
      ++attempt % 3 === 0
        ? of({ attempt, hits: query.length * 3, query })
        : throwError(
            () => new Error(`HTTP 500 for "${query}" (attempt ${attempt})`),
          ),
    ),
    tag("typeahead.api.request"),
  );

const scripted = new Subject<string>();
const keystrokes = queryInput
  ? merge(
      fromEvent(queryInput, "input").pipe(map(() => queryInput.value)),
      scripted,
    )
  : scripted;

keystrokes
  .pipe(
    tag("typeahead.keystrokes"),
    debounceTime(200),
    tag("typeahead.query"),
    switchMap((query) =>
      flakyApi(query).pipe(
        retry({ count: 3, delay: 80 }),
        tag("typeahead.api.retried"),
      ),
    ),
    map((r) => `"${r.query}" -> ${r.hits} hits (api attempt #${r.attempt})`),
    tag("typeahead.results"),
  )
  .subscribe((line) => write(output, line));

document.querySelector("#demo")?.addEventListener("click", () => {
  const script: [number, string][] = [
    [0, "r"],
    [60, "rx"],
    [120, "rxj"],
    [180, "rxjs"],
    [1600, "rxjs spy"],
    [2400, "ngrx"],
  ];
  script.forEach(([ms, text]) => {
    setTimeout(() => {
      if (queryInput) {
        queryInput.value = text;
      }
      scripted.next(text);
    }, ms);
  });
  write(output, "scripted demo: rxjs (burst), rxjs spy, ngrx (mid-retry switch)");
});

document.querySelector("#clear")?.addEventListener("click", () => {
  if (queryInput) {
    queryInput.value = "";
  }
  if (output) {
    output.textContent = "(type above or run the scripted demo)";
  }
  if (trace) {
    trace.textContent = "(waiting for notifications)";
  }
  attempt = 0; // scripted demo replays with the same attempt numbers
  spy.flush(true); // drop records of closed subscriptions for clean snapshots
});

// Mirror of the spy's log ring buffer, polled like an MCP agent would.
let sinceIndex = 0;
setInterval(() => {
  const { entries, nextIndex } = spy.logEntries(sinceIndex, 100);
  sinceIndex = nextIndex;
  if (!entries.length) {
    return;
  }
  const lines = entries.map((entry) => {
    const detail =
      entry.notification === "next"
        ? ` ${JSON.stringify(entry.value)}`
        : entry.notification === "error"
          ? ` ${JSON.stringify(entry.error)}`
          : "";
    return `${String(entry.index).padStart(3)} ${NOTIFICATION_LETTERS[entry.notification]} ${(entry.tag ?? `#${entry.observableId}`).padEnd(24)}${detail}`;
  });
  if (trace && trace.textContent?.startsWith("(waiting")) {
    trace.textContent = "";
  }
  write(trace, lines.reverse().join("\n"));
}, 400);
