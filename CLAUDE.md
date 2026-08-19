# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

rxjs-spy v9 — a debugging library for RxJS (peer dep `rxjs ^7.8.0`), rewritten from scratch in `src/`. Instead of the legacy human-typed `window.spy` console API, it installs a JSON-first global surface (`window.__RXJS_SPY__`) designed to be driven by an AI agent through Chrome DevTools MCP `evaluate_script`.

**Legacy tree:** `source/` is the frozen v8 reference implementation. Its toolchain (karma.conf.js, webpack*.js, rollup.config*.js, tslint.json, babel.config.js, scripts/, package-dist.json, tsconfig-dist.json, superstatic.json, .travis.yml) is dead — none of it is wired to package.json anymore. Do not modify `source/`; it is reference material slated for deletion once v9 reaches parity.

## Commands

- `npm install` — npm only (package-lock.json); yarn was dropped with the v9 rewrite.
- `npm test` — Vitest, all unit tests (`src/**/*.test.ts`, node environment).
- `npx vitest run src/spy.test.ts` — single test file; `npx vitest run -t "flattened"` — single test by name.
- `npm run typecheck` — `tsc --noEmit` (TS strict; `source/` is excluded).
- `npm run lint` — ESLint flat config; `no-explicit-any` is an error.
- `npm run build` — tsup: dual ESM/CJS + `.d.ts` into `dist/` for two entries (`.` and `./operators`), rxjs external.
- `npm run harness` — Vite dev server, opens `/harness/index.html`; the page imports `src/` directly (no build step needed).

## Architecture

The spy patches `Observable.prototype.subscribe` using **public RxJS API only** — no `lift()`, no `SafeSubscriber` recovery, no internals. Key flow (all in `src/spy.ts`):

1. The patched subscribe normalizes args to a `Partial<Observer>`, creates a `SubscriptionRecord`, and delegates to the original subscribe with a wrapping observer.
2. **Graph inference** uses a notification stack owned by the Spy: a subscribe occurring while another record's subscribe frame is on the stack becomes a `source` of that record; one occurring during a `next` frame is a *flattening* (`flattened: true`, e.g. mergeMap/switchMap inner subscriptions). Roots (records with no `sink`) are the application's own subscribe calls.
3. Unsubscribe is intercepted by instance-patching `unsubscribe` on the returned `Subscription`. Every record's hook sequence follows the lifecycle grammar `S N* (C|E)? U`: terminal notifications fire the unsubscribe hooks themselves (RxJS always tears down after complete/error), and the patched `unsubscribe` fires them only for cancellations, so there is exactly one U per subscription (test: "lifecycle grammar" in `src/spy.test.ts`). When the caller passed its own `Subscriber`/`Subscription` (every operator does internally), the returned subscription is `add()`ed to it — this restores stock RxJS teardown chaining so operator-driven unsubscription (e.g. switchMap cancelling its inner) still tears down the source. Regression test: "propagates operator-driven unsubscription" in `src/spy.test.ts`.
4. **Error fidelity:** if the consumer supplied no error handler, the wrapper rethrows so RxJS's own unhandled-error reporting (`config.onUnhandledError`) fires exactly as without the spy. There is a test pinning this against rxjs 7.8.2.

Supporting modules:

- `src/metadata.ts` + `src/operators/tag.ts|hide.ts` — tags/hidden flags live in a WeakMap keyed by the observable returned from the operator (which wraps the source in a plain `new Observable`). `hide()` suppresses tracing for the whole synchronous subscription subtree.
- `src/match.ts` — `Match = string | RegExp | predicate | Observable`; strings match tag or ids; `parseMatch()` turns `"/exp/flags"` strings (from the MCP boundary) into RegExps.
- `src/serialize.ts` — `toSerializable()` makes any runtime value JSON-safe with bounded size (circulars, functions, observables, errors → descriptive strings) and redacts sensitive-looking keys by default (`DEFAULT_REDACT_KEYS`, case-insensitive substring match — spy output is read by AI agents, secrets must not leave the page). Everything crossing the MCP boundary goes through it.
- `src/snapshot.ts` — pure function building the JSON-safe subscription-graph tree from records.
- `src/plugin.ts` — the plugin seam (`before*`/`after*` hooks). Deferred v8 features (pause decks, cycle detection, stats, debug, let) are meant to return as plugins; `src/log-plugin.ts` is the model implementation.
- `src/surface.ts` — the `__RXJS_SPY__` global: `help()`, `status()`, `listTags()`, `snapshot()`, `lifecycles()` (leak check: open subscriptions = S without U), `log()`/`logs()`/`activeLogs()`/`unlog()`, `flush()`, `teardown()`. All methods are synchronous, JSON-only, and return `{ error: { message } }` instead of throwing. `help()` is machine-readable and must stay in sync with the surface (a test enforces this).
- `src/ring-buffer.ts` — log entries are buffered with monotonic indices; agents poll incrementally via `logs({ sinceIndex })` rather than scraping console output.
- `src/panel.ts` — `mountDebugPanel(spy)`, a self-contained in-page overlay (status + live trace) shipped as the separate `rxjs-spy/panel` export so it stays out of bundles unless imported. DOM tests use `// @vitest-environment happy-dom`.

## The MCP debugging workflow this is built for

1. App under debug calls `create()` (and tags streams with `tag("name")` from `rxjs-spy/operators`).
2. An agent connected via Chrome DevTools MCP evaluates `__RXJS_SPY__.help()` to discover the surface, then `status()` / `snapshot({ match })` to inspect the graph, then `log(match)` and repeated `logs({ sinceIndex })` polls to trace live values.
3. Console output is prefixed `[rxjs-spy]` so it can also be filtered from MCP console-message tools.

## Conventions

- TypeScript strict, no `any` on exported APIs; Prettier defaults (2-space); alphabetized object keys/imports are the norm in `src/`.
- Tests are colocated `*.test.ts` (Vitest). Spy tests must `teardown()` in `afterEach` — `create()` twice throws because of the active-spy singleton guard.
- Conventional Commits. Never commit or push unless explicitly asked.
- Deferred/planned: Playwright E2E against the harness, dedicated MCP server package, pause/step + cycle + stats plugins, legacy `source/` deletion.
