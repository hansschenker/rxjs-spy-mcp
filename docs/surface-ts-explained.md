# `src/surface.ts`, explained in detail

If `spy.ts` is the engine, `surface.ts` is the **boundary layer**: it wraps a live `Spy` instance into the global object (`window.__RXJS_SPY__`) that the outside world talks to. It is the only file in the codebase that knows the output will cross an *evaluate boundary* — the serialization gap between the page and whoever runs JavaScript in it (an MCP agent, the DevTools console, `page.evaluate` in a test).

Reading companions: `src/spy.ts` (what's being wrapped), `src/surface.test.ts` (the contract), and the "What Chrome DevTools MCP actually does here" section of `rxjs-spy-mcp-explained.md` (why the boundary matters).

---

## 1. The contract the whole file serves

Every method on the surface obeys four rules, and each rule exists because of the evaluate boundary:

1. **Arguments are JSON-plain.** No RegExp objects, no observables, no callbacks — a regex arrives as the *string* `"/^orders/i"` and is revived by `parseMatch`. Reason: an agent composes its call as a text expression; only literals survive.
2. **Results are JSON-safe and bounded.** Everything heavy goes through `toSerializable` (in `snapshot.ts`/`log-plugin.ts` before it ever reaches this file) or is built here from primitives. Reason: evaluate results are serialized; a live object or circular structure would be lost or explode.
3. **Synchronous only.** No promises. Reason: a sync expression's value comes back in one round-trip; an agent shouldn't need to poll for the *result of asking*.
4. **Never throws.** Failures come back as a value: `{ error: { message, name } }`. Reason: a thrown exception inside an evaluate call surfaces as a generic tool error the agent can't read; an error *value* is data it can react to (e.g. an invalid regex in `snapshot({ match: "/[/" })` — pinned by the test *"returns an error envelope instead of throwing"*).

Everything else in the file is machinery for these four rules.

## 2. The type section: results as public API

The first half of the file is interfaces: `StatusResult`, `TagsResult`, `LogsOptions`/`LogsResult`, `SurfaceSnapshotOptions`, `LifecycleItem`/`LifecyclesOptions`/`LifecyclesResult`, `MethodDescriptor`/`HelpResult`, `SurfaceError`, and finally `SpySurface` itself.

Two things to notice:

- **Every method's return type is `T | SurfaceError`.** The union is deliberate: TypeScript consumers (like `harness/main.ts`'s lifecycles button) are forced to check `"error" in result` before using the data — the same discipline an agent needs.
- **`SurfaceSnapshotOptions.match` is a `string`**, while the internal `SnapshotOptions.match` (in `snapshot.ts`) is the rich `Match` union. That narrowing *is* the boundary: rich types inside, strings outside. The comment on the field documents the accepted forms (tag, `"/regex/"`, observable id, record id).

## 3. `guard`: exceptions become values

```ts
function guard<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | SurfaceError {
  return (...args: A) => {
    try { return fn(...args); }
    catch (error) {
      return { error: { message: error instanceof Error ? error.message : String(error),
                        name:    error instanceof Error ? error.name : undefined } };
    }
  };
}
```

A tiny higher-order function, but it's rule 4 implemented once instead of eleven times. Every method in `createSurface` is defined as `guard(implementation)`. The generics preserve each method's real signature (`A` = its argument tuple, `R` = its result), so the union types on `SpySurface` line up without casts. Note the implementations are arrows capturing `spy` from the closure — that's why destructuring a method off the surface (`const { status } = surface; status()`) still works: nothing depends on `this`.

## 4. `createSurface`: eleven methods, one pattern

Each method is a thin adapter: *parse the string-world input → call the Spy → shape a JSON-plain result → sometimes attach a `note` string for the agent.* In alphabetical order as they appear:

### `activeLogs()` / `unlog(logId?)`
Direct pass-throughs to `spy.logs()` (the list of `{ logId, match }` handles) and `spy.unlog()` (returns `{ removed }`). They exist so an agent can manage its own logging session without holding any state beyond a number.

### `flush()`
`spy.flush(true)` — the **forced** variant. Rationale: the spy already does lazy age-based flushing internally (`status()`/`snapshot()` call `spy.flush()` un-forced); if someone explicitly asks the surface to flush, they mean *now*, not "whenever keptDuration says so".

### `help()`
Delegates to `helpFor(spy)` (§6). The self-description mechanism.

### `lifecycles(options?)` — the leak check
The largest method, and the one that turns the lifecycle grammar into a query:

1. **Lazy flush first**, so long-dead records don't pollute the report.
2. **Scope selection:** by default only *roots* (`record.sink === undefined` — the application's own subscribe calls, one per pipeline); `all: true` widens to every record.
3. **Matching with subtree semantics:** `subtreeMatches` accepts a root if *any* record beneath it matches. This matters because roots are often untagged — `interval().pipe(tag("clock"), take(60)).subscribe()` has the untagged `take` wrapper as its root, with the tag one level down. (With `all: true` and a match, plain direct matching is used instead — you asked for individual records.)
4. **Sequence rendering:** `toSequence` compresses a record into the grammar string — `S`, then `N` literally up to five times or `N×42` beyond, then `C`/`E` if terminal, then `U` if closed. An open subscription simply lacks the `U`.
5. **The split:** closed records are only counted; **open** records become `LifecycleItem`s with `ageMs`, the sequence, the first five stack frames (the subscribe site — where you'd add the missing `takeUntil`), and two naming fields: `tag` (the root's own, often undefined) plus `tags` (every tag collected from its subtree — so the clock example reports as `["clock"]` instead of an anonymous `#1`).
6. **`olderThanMs`** filters out young open subscriptions — the standard way to separate "should still be live" from "probably leaked".

The `note` in the result states the grammar and the interpretation rule, so even an agent that never read the docs can act on the output.

### `listTags()`
An aggregation: walk `spy.records()`, group by tag into a `Map`, collecting a `Set` of observable ids, total/active subscription counts (`isClosed` decides active), and summed `nextCount`. Answers "which streams exist and how busy are they" in one call.

### `log(match?, options?)`
Revives the match (`parseMatch` unless omitted → match-everything), delegates to `spy.log`, and spreads the returned `LogHandle` with an appended `note` telling the caller the two consumption paths (poll `logs({ sinceIndex })`; console lines carry the `[rxjs-spy]` prefix and S/N/E/C/U letters). Notes like this are cheap agent-steering: the response itself teaches the follow-up call.

### `logs(options?)`
The incremental read: spreads `spy.logEntries(sinceIndex ?? 0, limit ?? 100)` — entries with monotonic indices plus `nextIndex` — and a `note` spelling out the polling contract (*pass nextIndex back as sinceIndex*). Entries are already JSON-safe because `LogPlugin` serialized values at capture time.

### `snapshot(options?)`
Maps the surface options onto the internal ones one-to-one, with exactly one transformation: `parseMatch` on the match string. The heavy lifting (tree building, value serialization, node limits) lives in `snapshot.ts`; the spy method it calls also lazy-flushes first.

### `status()`
The orientation call: lazy flush, then counts (`active`/`closed`/`records`, plus `logWrites` — read cheaply as `spy.logEntries(0, 0).nextIndex`, i.e. "how many entries were ever written" without fetching any), the deduplicated tag list, tick, version — and a `hint` string pointing at `help()`, `snapshot()`, and `log()`/`logs()`. An agent that evaluates only `status()` already knows what to do next.

### `teardown()`
Delegates to `spy.teardown()` and returns `{ torndown: true }`. Mildly self-referential: tearing down uninstalls the very global this object is reachable through. That's safe — the object itself stays alive for anyone holding a reference, and its closures still point at the (now inert) spy.

## 5. `installSurface`: polite global installation

```ts
const had = Object.prototype.hasOwnProperty.call(scope, globalName);
const previous = scope[globalName];
scope[globalName] = createSurface(spy);
return () => { if (had) scope[globalName] = previous; else delete scope[globalName]; };
```

Three details:

- It installs on **`globalThis`**, not `window` — which is why the whole surface is unit-testable in plain Node (all of `surface.test.ts` runs without a DOM).
- It distinguishes *"the property existed with some value"* from *"the property didn't exist"* using `hasOwnProperty` — so the uninstaller either **restores** the previous value or **deletes** the property, never leaving a stray `undefined` behind. Test: *"installs on globalThis and uninstalls on teardown"*.
- The uninstaller is a closure returned to the caller (`Spy`'s constructor keeps it and invokes it in `teardown()`).

## 6. `helpFor`: enforced self-description

`helpFor` returns the `HelpResult`: name, version, a one-paragraph description (which itself teaches the calling convention — synchronous, JSON, evaluate, tag your streams), and one `MethodDescriptor` per method with `name`, `signature`, `description`, `example`.

The critical part is not the data — it's the **test** that keeps it honest (*"describes every surface method in help()"* in `surface.test.ts`): it takes `help().methods`, checks each named method actually exists on the surface as a function, and then compares the *sorted list of descriptor names* against `Object.keys(surface)`. Add a method without documenting it — or document one that doesn't exist — and the suite fails. Self-description is a feature only if it can't drift; the test is what makes `help()` trustworthy enough for an agent to self-configure from.

## 7. The import-cycle footnote

`spy.ts` imports `installSurface` from this file at runtime; this file needs `Spy` and `LogHandle` — but imports them with `import type`, which `verbatimModuleSyntax` guarantees is fully erased at compile time. So the dependency cycle exists only in the type graph, never in the emitted JavaScript: at runtime, `surface.ts` receives its `Spy` purely as a function argument. (Same pattern in `panel.ts`.)

---

## The invariants, in one list

1. **Strings in, JSON out, synchronously** — nothing rich crosses the boundary in either direction.
2. **Never throws** — `guard` converts every failure into an `{ error }` value the caller can read.
3. **Self-describing, and provably so** — `help()` is locked to the real surface by a test.
4. **Lazy housekeeping** — read methods (`status`, `snapshot`, `lifecycles`, `listTags`) flush stale records first, so answers describe the present, not the last 30 seconds of history.
5. **Responses teach the next step** — `hint`/`note` fields steer a cold-start agent (or human) toward the right follow-up call.
6. **A polite guest on the global object** — install remembers what was there; uninstall puts it back exactly.
