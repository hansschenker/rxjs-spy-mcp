# rxjs-spy-mcp, explained

The debugger's output can look dense at first. This page explains the handful of ideas behind it — once you know them, every line of output becomes readable.

## The idea in one paragraph

RxJS code is hard to debug because the interesting things (values flowing, requests being cancelled, retries firing) happen *inside* composed observables where `console.log` can't see them. rxjs-spy-mcp fixes this in two moves: you **name** the streams you care about with `tag("some-name")` (which changes nothing about how they behave), and a **spy** watches every subscription in the page and records what happens. You then ask the spy questions — either by clicking around the harness's debugger panel, or by letting an AI agent query `window.__RXJS_SPY__` through Chrome DevTools MCP.

```ts
import { create } from "rxjs-spy";
import { tag } from "rxjs-spy/operators";

create(); // start spying (usually only in dev builds)

const results$ = queries$.pipe(
  tag("search.query"),          // <- a name, nothing more
  switchMap((q) => api(q)),
  tag("search.results"),
);
```

## The five events

Everything the spy reports is one of five notifications, and they mean exactly what they do in RxJS:

| Notification | Meaning |
|---|---|
| `subscribe` | someone started listening to the stream |
| `next` | the stream emitted a value (shown inline) |
| `error` | the stream failed (message + stack shown inline) |
| `complete` | the stream finished normally |
| `unsubscribe` | the listener was cancelled before the stream finished |

Two patterns are worth recognizing on sight:

- **`error` followed by another `subscribe` on the same tag = a retry.** `retry()` works by resubscribing, so each attempt shows up as its own subscribe/error pair.
- **`unsubscribe` before any `complete` = a cancellation.** This is `switchMap` killing a stale request, `takeUntil` firing, or you calling `.unsubscribe()`. If you suspect a leak, this is the event you're looking for — or missing.

## The subscription record

Every `subscribe` call creates one **record**. A record is always in exactly one state, shown in snapshots:

- `ACTIVE` — still running
- `completed` — finished normally
- `ERRORED` — died with an error (kept, with the error, so you can inspect it after the fact)
- `unsubscribed` — cancelled

Each record also keeps: its tag (if any), how many values it emitted (`next=N`), its **latest few values** (default 4), and the stack trace of where in your code `.subscribe()` was called. Closed records are kept for 30 seconds and then dropped, so snapshots show recent history, not everything since page load.

## The graph: why snapshots are trees

Observables are pipelines: when you subscribe to the end of a pipe, each stage subscribes to the stage before it. The spy records those relationships, so a snapshot is a tree:

- **Roots** are your application's own `.subscribe(...)` calls.
- **Nested rows** are the upstream stages feeding them.
- **`(flattened)`** marks an *inner* stream created mid-flight by an operator like `mergeMap`/`switchMap` — e.g. one HTTP request spawned per query.
- **Untagged rows** like `(Observable2)` are intermediate operator stages you didn't name. Skim past them; the tagged rows tell the story. (Tag more stages if you want more landmarks.)

Reading a real example:

```
search [ACTIVE] next=2                       <- your subscribe; got 2 results so far
    search.query [ACTIVE] next=3             <- 3 queries came through the debounce
      search.results [completed] (flattened) <- query #1's request: finished fine
      search.results [unsubscribed] (flattened) <- query #2's request: CANCELLED by switchMap
      search.results [completed] (flattened) <- query #3's request: finished fine
```

That one tree answers: how many requests were made, which were cancelled, which succeeded, and what they returned (`values=[...]`).

## The surface: `window.__RXJS_SPY__`

`create()` installs a global object whose methods all return plain JSON — that's what makes it drivable by an AI agent over MCP `evaluate_script`. In the order you'd typically use them:

| Call | The question it answers |
|---|---|
| `help()` | "What can this thing do?" — machine-readable method list |
| `status()` | "What's the overall state?" — counts, known tags, version |
| `listTags()` | "Which streams exist and how busy are they?" |
| `log("search")` | "Start recording everything that happens to `search`" |
| `logs({ sinceIndex: 0 })` | "Give me what was recorded since I last asked" |
| `snapshot({ match: "search" })` | "Show me the subscription tree for `search` right now" |
| `unlog()` / `flush()` | stop recording / drop closed records now |
| `teardown()` | stop spying entirely and restore RxJS untouched |

Two details that matter:

- **`logs()` is a ring buffer you poll.** Every recorded notification gets an increasing index. You call `logs({ sinceIndex: 0 })`, note the returned `nextIndex`, and pass it back next time — you only ever get new entries. This is how an agent "watches live" without scraping the console.
- **`match` is a string with three forms:** a tag (`"search"`), a regex (`"/^search/"` — matches `search`, `search.query`, `search.results`...), or an observable/record id number.

Values crossing this boundary are made JSON-safe and size-bounded: long strings are truncated, deep objects cut off, and things like functions or observables become short labels (`"[Observable #12 tag=search]"`). What you see is a faithful sketch, not a live reference.

## Using it in your own project

Four steps: install the package, start the spy at app startup, tag the pipeline, then read the trace.

### 1. Install

Not on npm yet, so install from GitHub (the package builds itself on install):

```sh
npm install --save-dev github:hansschenker/rxjs-spy-mcp
```

Or from a local clone:

```sh
git clone https://github.com/hansschenker/rxjs-spy-mcp
cd rxjs-spy-mcp && npm install && npm run build
cd ../your-project && npm install --save-dev ../rxjs-spy-mcp
```

Either way the package **name stays `rxjs-spy`** — you import from `"rxjs-spy"` and `"rxjs-spy/operators"`. It needs rxjs `^7.8.0` as a peer, and there must be only **one copy of rxjs** in your `node_modules` (the spy patches the prototype of the rxjs *it* imports — run `npm ls rxjs` if in doubt; you should see a single deduped version).

### 2. Start the spy at startup, dev only

Call `create()` **once, before anything subscribes** — streams that subscribed earlier are invisible to it. Guard it so it never ships enabled to production:

```ts
// Angular — main.ts, before bootstrapping:
import { isDevMode } from "@angular/core";
import { create } from "rxjs-spy";

if (isDevMode()) create();
bootstrapApplication(AppComponent, appConfig);
```

```ts
// Vite (React/Vue/vanilla) — entry file:
if (import.meta.env.DEV) {
  const { create } = await import("rxjs-spy");
  create();
}
```

### 3. Tag the pipeline you want to trace

Drop `tag()` at every stage whose values you care about — each tag becomes a named checkpoint in the trace:

```ts
import { tag } from "rxjs-spy/operators";

this.results$ = this.query$.pipe(
  tag("orders.query"),                                    // what comes in
  debounceTime(300),
  tag("orders.query.debounced"),                          // what survives the debounce
  switchMap((q) => this.api.search(q).pipe(tag("orders.request"))), // each request
  tag("orders.results"),                                  // what the UI receives
);
```

`tag()` is behavior-neutral and near-zero-cost when no spy is active, so leaving tags in the codebase is fine.

### 4. Read the trace

Run your app in Chrome. The quickest way, straight in the DevTools console:

```js
__RXJS_SPY__.log("/^orders/")            // start recording; console lines get a [rxjs-spy] prefix
// ... use your app ...
__RXJS_SPY__.logs({ sinceIndex: 0 })     // the recorded timeline as JSON
__RXJS_SPY__.snapshot({ match: "/^orders/" }) // the subscription tree right now
__RXJS_SPY__.unlog()                     // stop recording
```

Or hand it to your AI assistant with Chrome DevTools MCP connected: *"Connect to my app's tab and debug the `orders` stream — snapshot its subscription graph and log its emitted values."* The agent runs the same calls and reads the JSON back.

For programmatic use (e.g. piping the trace into your own tooling), `create()` returns a `Spy` with the same capabilities: `spy.log(match, { console: false })`, `spy.logEntries(sinceIndex)`, `spy.snapshot()`, and `spy.teardown()` to stop spying and restore RxJS untouched.

## Where to see it

- **Humans:** `npm run harness` — the page's right column is the debugger panel: a status line, the live log stream, and a "Take snapshot" button. The "Typeahead + flaky API" button runs a scripted scenario with a debounce collapse, a retry saga, and a mid-retry cancellation, so you can watch every concept above happen in a few seconds.
- **AI agents:** connect Chrome DevTools MCP to the tab and ask your assistant to debug a tagged stream. The recipe it follows: `help()` → `snapshot({ match })` → `log(match)` + poll `logs({ sinceIndex })`. A full annotated session is in [mcp-debug-session.md](mcp-debug-session.md).

## What it deliberately doesn't do (yet)

Pause/step-through of live streams, cycle detection, and stats from the original rxjs-spy v8 are not reimplemented yet — the plugin seam for them exists. The spy also can't see subscriptions made before `create()` ran, or streams wrapped in `hide()`.
