# rxjs-spy-mcp

A debugging library for RxJS 7, rewritten so that an **AI agent can debug your streams through [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)**.

This is a v9 greenfield rewrite of [cartant/rxjs-spy](https://github.com/cartant/rxjs-spy) by Nicholas Jamieson (MIT). The original library let *you* debug observables by typing `spy.log(...)` into the DevTools console. This rewrite keeps the core idea — tag your observables, let a spy watch every subscription — but replaces the human-typed console API with a JSON-first global surface (`window.__RXJS_SPY__`) that an AI assistant drives via MCP `evaluate_script`, reading back subscription graphs, live values, and errors as structured data.

**Status: `9.0.0-dev` — core feature set working (tag/hide, tracking, graph + snapshots, buffered logging). Not yet published to npm.**

## How it works

```ts
import { create } from "rxjs-spy";
import { tag } from "rxjs-spy/operators";

const spy = create(); // patches Observable.prototype.subscribe, installs window.__RXJS_SPY__

// Tag the streams you care about — tag() has zero effect on behavior:
const results$ = queries$.pipe(
  tag("search.query"),
  switchMap((q) => fetchResults(q).pipe(tag("search.results"))),
  tag("search"),
);
```

Then, in your IDE's AI chat with Chrome DevTools MCP connected:

> "Connect to my app's tab and debug the `search` stream — show me its subscription graph and log its emitted values."

The agent evaluates calls like these in the page and gets pure JSON back:

```js
__RXJS_SPY__.help()                      // machine-readable method list — agents self-configure from this
__RXJS_SPY__.status()                    // { spying, version, tick, counts, tags }
__RXJS_SPY__.snapshot({ match: "search" }) // subscription graph: state, latest values, subscribe-site stack traces
__RXJS_SPY__.log("search")               // start capturing notifications ({ logId })
__RXJS_SPY__.logs({ sinceIndex: 0 })     // poll buffered entries incrementally; pass back nextIndex
__RXJS_SPY__.unlog(); __RXJS_SPY__.flush(); __RXJS_SPY__.teardown()
```

Everything returned by the surface is JSON-serializable with bounded size (circular references, functions, observables, and errors become short descriptive strings), so results survive the MCP evaluate boundary. Notifications are also written to the console with a `[rxjs-spy]` prefix for MCP console-message filtering, but the ring-buffered `logs({ sinceIndex })` polling is the intended consumption path — no console scraping.

`match` accepts a tag string (`"search"`), a regex string (`"/^search/"`), or an observable/record id.

## What's different from cartant/rxjs-spy v8

- **RxJS 7.8, public API only.** No deprecated `lift()`, no `SafeSubscriber` recovery hacks. `tag()`/`hide()` store metadata in a WeakMap; the spy patches `Observable.prototype.subscribe` cleanly and restores stock teardown chaining for caller-supplied subscribers.
- **MCP-first surface** (`__RXJS_SPY__`) instead of `window.spy` console commands.
- **Modern toolchain:** TypeScript 5 strict, tsup (dual ESM/CJS + types), Vitest, ESLint, Vite harness.
- **Core-first scope:** logging, graph + snapshot queries. The v8 pause/step decks, cycle detection, and stats are deferred; the plugin seam (`SpyPlugin`) is in place for them.
- The frozen v8 implementation remains in `source/` as reference until parity; for v8 docs see the [original repo](https://github.com/cartant/rxjs-spy).

## Development

```sh
npm install
npm test            # Vitest unit tests
npm run build       # tsup -> dist/ (ESM + CJS + .d.ts)
npm run harness     # Vite dev page with tagged demo streams to point an MCP agent at
```

See `CLAUDE.md` for the architecture map, and [docs/mcp-debug-session.md](docs/mcp-debug-session.md) for a real debugging session — a flaky-API typeahead pipeline traced end to end through the MCP surface, including two bugs the session caught.

## Credit & license

MIT. Based on [rxjs-spy](https://github.com/cartant/rxjs-spy) © Nicholas Jamieson; the tag-and-spy concept and the plugin architecture are his. v9 rewrite by Hans Schenker.
