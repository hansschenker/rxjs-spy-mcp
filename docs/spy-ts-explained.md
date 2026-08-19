# `src/spy.ts`, explained in detail

This is the heart of rxjs-spy-mcp: one file that does the interception (patching `Observable.prototype.subscribe`), the bookkeeping (subscription records, the graph, the tick counter, the log ring buffer), and the plugin dispatch. Everything else in `src/` either feeds it (`metadata.ts`, `identify.ts`) or consumes it (`surface.ts`, `snapshot.ts`, `panel.ts`).

Reading companion: keep `src/record.ts` (the `SubscriptionRecord` shape) and `src/spy.test.ts` open — the tests are the behavior contract, and several are named below.

---

## 1. Module-level state

```ts
let currentSpy: Spy | undefined;
let suppressDepth = 0;
```

Two pieces of state live at module level, **not** on the class:

- `currentSpy` — the active-spy singleton. There can be only one spy, because there is only one `Observable.prototype.subscribe` to patch. The constructor throws `"Already spying..."` if one exists (test: *"throws when created twice"*), and `teardown()` clears it. This is also why every test does `spy.teardown()` in `afterEach`.
- `suppressDepth` — a counter that silences tracing while a `hide()`-marked observable's subscription subtree is being built (see §4).

They are module-scoped so the patched function — which outlives any particular call — can consult them with plain closure access, and so `teardown()`/`create()` cycles work: spy A restores, spy B patches fresh.

## 2. The type dance: `SubscribeFn` vs `GenericSubscribe`

```ts
type SubscribeFn = typeof Observable.prototype.subscribe;
type GenericSubscribe = (this: Observable<unknown>, ...args: unknown[]) => Subscription;
```

RxJS declares `subscribe` with overloads (observer object, or next/error/complete callbacks — the latter deprecated but still real). You cannot conveniently *implement* an overloaded method, so the patch is written as `GenericSubscribe` — "any args, returns a Subscription" — and cast to `SubscribeFn` at the assignment. The cast is safe in the useful direction: a function accepting `unknown[]` accepts everything the overloads allow.

## 3. The constructor: install everything, atomically

Order matters here:

1. **Singleton guard** — throw before touching anything if a spy exists.
2. **Options with defaults** — `keptDuration` 30 s (how long closed records linger), `keptValues` 4 (latest values per record), `logBufferSize` 1000, `stackTraces` on, `logger` = console.
3. **Capture the original** — `this.originalSubscribe_ = Observable.prototype.subscribe`. This exact reference is what `teardown()` restores and what every spied subscribe delegates to.
4. **Build and install the patch** — via a *static factory* (`Spy.createPatchedSubscribe_(this, original)`). Why a static method instead of `const spy = this` in the constructor? The patched function must be a `function` (it needs `this` = the observable being subscribed), so an arrow won't do; and aliasing `this` into a closure variable trips ESLint's `no-this-alias`. Passing the spy as a *parameter* to a static factory sidesteps both, and statics may touch private members of instances of their own class.
5. **Register as current** — `currentSpy = this` (with a targeted lint suppression: it's module-level registration, not a local alias).
6. **Install the MCP surface** — `installSurface(this, "__RXJS_SPY__")` unless `installGlobal: false` (tests use that constantly). The returned uninstaller is kept for teardown.

## 4. The patched subscribe: three paths

```ts
return function (this: Observable<unknown>, ...args: unknown[]): Subscription {
  if (currentSpy !== spy || suppressDepth > 0) return original.apply(this, args);
  if (isHidden(this)) {
    suppressDepth += 1;
    try { return original.apply(this, args); }
    finally { suppressDepth -= 1; }
  }
  return spy.spySubscribe_(this, args);
};
```

- **Path 1 — bail out.** If this spy is no longer the current one (torn down, or a newer spy took over) or tracing is suppressed, delegate untouched. Checking `currentSpy !== spy` (not just "is there a spy") means a stale patched function left on the prototype by some third party can never route into a dead spy.
- **Path 2 — hidden.** `hide()` marks an observable in the WeakMap (`metadata.ts`). Subscribing to it bumps `suppressDepth` for the duration of the *synchronous* subscribe call, so every nested subscribe underneath (the whole chain being wired up) is also invisible. This mirrors the legacy v8 trick of nulling the spy, and it is how the spy would avoid tracing itself if it ever subscribed to anything. Test: *"ignores hidden observables and their subtree"*.
- **Path 3 — spy.** The interesting one, below.

## 5. `spySubscribe_`: one observed subscription, start to finish

### 5.1 Normalize the observer

`toPartialObserver(args)` (bottom of the file) collapses the legal call shapes into one `Partial<Observer>`:

- `subscribe(observerObject)` → returned as-is. **Important:** this includes `Subscriber` instances, which is what every RxJS operator passes internally (`source.subscribe(operatorSubscriber)`).
- `subscribe(next?, error?, complete?)` → wrapped into `{ next, error, complete }`, with `null`s normalized to `undefined`.

This ~12-line function replaces the legacy v8 hack that recovered RxJS's internal `SafeSubscriber` constructor by subscribing to a throwaway observable. No internals are needed: we never construct a Subscriber ourselves — we hand the original `subscribe` a plain observer and let RxJS wrap it however it wants.

### 5.2 Create the record and link the graph

```ts
const record = this.createRecord_(observable);
const top = this.stack_[this.stack_.length - 1];
if (top) {
  record.sink = top.record;
  record.rootSink = top.record.rootSink ?? top.record;
  record.flattened = top.kind === "next";
  top.record.sources.push(record);
}
```

The **notification stack** (`stack_`) is the whole graph-inference mechanism, and it exploits one fact: RxJS wires pipelines *synchronously and re-entrantly*. When you subscribe to `source.pipe(map(...))`, the map-observable's subscribe runs, and *inside it* map subscribes to `source` — which re-enters our patched subscribe while the outer record's frame is still on the stack. So:

- top frame is a `"subscribe"` frame → the new record is a **structural source** of it (the pipeline wiring itself up);
- top frame is a `"next"` frame → the new record is a **flattening**: it was created while a value was being delivered, which is exactly what `mergeMap`/`switchMap` inner subscriptions look like (test: *"marks flattened (inner) subscriptions"*);
- empty stack → this is a **root**: the application's own `.subscribe(...)` call.

`rootSink` is threaded down so any record can name its application-level ancestor without walking (test: *"links sources to sinks in the graph"*).

Known limitation (inherited from v8, documented in CLAUDE.md): subscriptions deferred by a scheduler (`subscribeOn`) happen later, when the stack is empty, so they appear as roots.

### 5.3 Hooks, delegate, and the wrapped observer

```ts
record.tick = ++this.tick_;
this.notify_("beforeSubscribe", record);
this.stack_.push({ kind: "subscribe", record });
try {
  const wrapped: Partial<Observer<unknown>> = {
    complete: () => this.observeComplete_(record, observer),
    error: (error) => this.observeError_(record, observer, error),
    next: (value) => this.observeNext_(record, observer, value),
  };
  subscription = (this.originalSubscribe_ as GenericSubscribe).call(observable, wrapped);
} finally {
  this.stack_.pop();
}
```

The spy substitutes its own `wrapped` observer and keeps the caller's real observer captured in the three `observe*_` closures. All notifications for this subscription now flow through the spy first, then onward. The `finally` guarantees the stack frame pops even if subscribing throws.

### 5.4 Intercept unsubscribe — on the instance

```ts
const originalUnsubscribe = subscription.unsubscribe.bind(subscription);
subscription.unsubscribe = () => {
  if (isClosed(record)) { originalUnsubscribe(); return; }
  record.tick = ++this.tick_;
  this.notify_("beforeUnsubscribe", record);
  record.unsubscribed = true;
  record.closedAt = Date.now();
  originalUnsubscribe();
  this.notify_("afterUnsubscribe", record);
};
```

An **own property** shadows the prototype method, so anyone calling `subscription.unsubscribe()` — application code or RxJS's internal teardown — hits the wrapper. The `isClosed` check makes it idempotent and prevents double-firing after a terminal notification already closed the record (test: *"fires unsubscribe hooks exactly once per subscription"*). This path marks `record.unsubscribed = true` — the state that means *cancelled*, as opposed to completed/errored.

### 5.5 The teardown-chain restoration (the bug the live test caught)

```ts
const [first] = args;
if (first instanceof Subscription && first !== subscription) {
  first.add(subscription);
}
```

This is the most subtle line in the file. Stock RxJS: when an operator calls `source.subscribe(itsOwnSubscriber)`, `subscribe` returns *that same subscriber* and registers the source's teardown **on it**. Operators rely on this — `switchMap` cancels a stale inner request by calling `innerSubscriber.unsubscribe()` and never looks at the return value.

The spy breaks that contract by handing the source a *different* observer (`wrapped`), so the teardown lands on the spy's subscription, not the caller's subscriber. Without this line, `switchMap`'s cancellation silently stopped reaching the source: in the first live MCP session, a cancelled inner timer kept running and emitted a phantom value. The fix re-attaches the chain: if the caller passed its own `Subscription`/`Subscriber`, `add()` our subscription to it, so unsubscribing the caller's subscriber tears ours down — which runs the instance-patched wrapper above, which fires the hooks and releases the source. Test: *"propagates operator-driven unsubscription to the source (switchMap)"* (it asserts the inner `Subject` really becomes `observed === false`).

## 6. The three notification handlers

### `observeNext_`

Bumps the tick, increments `nextCount`, pushes into `latestValues` (a ring capped at `keptValues` — test: *"keeps only keptValues latest values"*), fires `beforeNext`, then — crucially — pushes a `{ kind: "next", record }` frame before delegating to the real observer. Any subscribe that happens *inside* the consumer's `next` (i.e. an operator reacting to a value by subscribing to an inner observable) sees that frame and gets classified as a flattening. Popped in `finally`, then `afterNext`.

### `observeError_`

Marks the record errored (`error`, `errored`, `closedAt`) **before** delivering, then:

```ts
if (observer.error) observer.error(error);
else throw error;
```

The rethrow is deliberate fidelity engineering. If the consumer supplied no error handler, stock RxJS routes the error to its unhandled-error machinery (`config.onUnhandledError`). But the spy's `wrapped` observer *always* has an `error` method, which would make RxJS believe the error was handled — silently swallowing it. Rethrowing restores the stock outcome: RxJS 7's consumer-observer wraps partial-observer calls in try/catch and routes caught throws to unhandled-error reporting. Pinned by the test *"preserves unhandled-error reporting when no error handler is given"*, which asserts `config.onUnhandledError` fires exactly once.

The whole delivery sits in `try/finally` with `notifyTeardown_` in the `finally`, so the lifecycle-closing `U` is emitted even on the rethrow path.

### `observeComplete_`

Marks `completed` and `closedAt` **before** calling `observer.complete?.()` — so if the consumer's complete callback triggers an unsubscribe somewhere, the instance-patched wrapper sees a closed record and stays silent. Then `afterComplete`, then `notifyTeardown_`.

## 7. `notifyTeardown_`: the lifecycle-grammar guarantee

```ts
private notifyTeardown_(record: SubscriptionRecord): void {
  record.tick = ++this.tick_;
  this.notify_("beforeUnsubscribe", record);
  this.notify_("afterUnsubscribe", record);
}
```

Every subscription's hook/trace sequence follows the grammar **`S N* (C|E)? U`** — exactly one `U`, always last. Terminal notifications emit it here rather than relying on the instance-patched `unsubscribe`, for a concrete reason: a synchronously completing observable (`of(1)`) completes *during* `originalSubscribe_.call(...)`, before `spySubscribe_` has even received the subscription object to patch — so the internal teardown could never be observed there. Emitting `U` at the terminal is truthful (RxJS always tears down in a `finally` after complete/error) and covers every path. The cancel path (§5.4) fires the same hooks, and the two paths exclude each other via `isClosed`. Test: *"guarantees the lifecycle grammar S N* (C|E)? U in log entries"* asserts the literal strings `SNNCU`, `SEU`, `SNU`.

This guarantee is what makes `lifecycles()` (the leak check in `surface.ts`) a mechanical query: an `S` without its `U` *is* a live-or-leaked subscription.

## 8. `createRecord_` and `captureStackTrace`

`createRecord_` fills the full `SubscriptionRecord`: ids (`id` per record, `observableId` via the WeakMap-based `identify()`), `tag` looked up from metadata, `observableType` from the constructor name, timestamps, empty graph links, and — if `stackTraces` is on — the subscribe-site stack.

`captureStackTrace` throws no error; it reads `new Error().stack`, trims each line, keeps only frame lines (`at ...` for V8, `...@...` for Firefox), then skips the leading *internal* frames — its own name, `createRecord_`, `spySubscribe_`, and `Observable\d*\.subscribe` (the `\d*` matters: dev bundlers like Vite rename the class to `Observable2`, which is exactly how the panel once showed the spy's own frame as the "subscribe site"). The first frame that survives is application code; up to 10 frames are kept. In the leak report this becomes `at OrdersComponent.ngOnInit (orders.component.ts:31)` — the line you go fix.

## 9. `notify_`: defensive plugin dispatch

```ts
for (const plugin of this.plugins_.slice()) {
  const method = plugin[hook];
  if (typeof method !== "function") continue;
  try { method.call(plugin, record, arg); }
  catch (error) { this.logger_.warn?.(...); }
}
```

Three defenses: iterate a **copy** (a hook may plug/unplug during dispatch — `spy.log()` inside a hook would otherwise mutate the array mid-loop); tolerate missing hooks (all `SpyPlugin` methods are optional); and **never let a plugin break the stream** — a throwing plugin is logged and skipped, the application's values keep flowing (test: *"survives a throwing plugin"*).

## 10. Logging plumbing: `log` / `unlog` / `logs` / `logEntries`

`log(match?)` builds a `LogPlugin` whose sink is a closure pushing into the spy's single `RingBuffer<LogEntry>`, plugs it, and files it under an incrementing `logId`. Omitting `match` means "everything" (`() => true`). `console: false` drops the console mirror but the buffer always fills — that is what the surface's `logs({ sinceIndex })`, the harness panels, and `mountDebugPanel` poll via `logEntries(sinceIndex, limit)`, which returns entries with their monotonic buffer indices plus `nextIndex` for the next incremental poll. `unlog(id?)` unplugs one or all.

## 11. `flush`: retention with graph consistency

Records of closed subscriptions are kept `keptDuration` (30 s) so you can inspect *recent* history, then dropped. The rule is stricter than "closed and old": a record is deletable only if **its entire source subtree is deletable too** (`canDelete` recurses through `sources`). That keeps the graph consistent — you never end up with a surviving child pointing at a deleted parent. Deleted records are also pruned out of a surviving sink's `sources` array. `flush(true)` ignores the age check (used by the surface's `flush()` and the harness Clear button). Tests: *"flushes closed records immediately with force"*, *"...only after keptDuration"* (with fake timers).

## 12. `teardown`: leave no trace — carefully

Idempotent (`torndown_` flag). Unplugs all plugins (running their `teardown` hooks), clears log handles, and restores the prototype — **but only if the prototype still holds our patch**:

```ts
if (Observable.prototype.subscribe === this.patchedSubscribe_) {
  Observable.prototype.subscribe = this.originalSubscribe_;
} else {
  this.logger_.warn?.("...re-patched by other code...; leaving it in place.");
}
```

If some other instrumenter (zone.js, another devtool) patched on top of us, blindly restoring would rip *their* patch off. Instead we warn and leave the chain intact — our patch degrades to a pass-through anyway, because `currentSpy` no longer matches (§4, path 1). Finally the `__RXJS_SPY__` global is uninstalled. Test: *"patches and restores Observable.prototype.subscribe"*.

---

## The invariants, in one list

1. **One spy at a time**; a stale patch can never reach a dead spy (`currentSpy !== spy` check).
2. **Public API only** — no `lift()`, no `SafeSubscriber`, no RxJS internals; the only surfaces touched are `Observable.prototype.subscribe`, `Subscription#unsubscribe` (instance-level), and `Subscription#add`.
3. **Behavior fidelity** — values, completion, error semantics (including *unhandled* errors), and teardown chains behave exactly as without the spy; every deviation ever found became a regression test.
4. **Grammar `S N* (C|E)? U`** — exactly one `U` per subscription, always last.
5. **Plugins can observe everything and break nothing.**
6. **Hidden means invisible** — `hide()` suppresses the whole synchronous subtree, giving the spy (and users) a way to opt streams out.
