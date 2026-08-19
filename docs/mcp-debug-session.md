# Live MCP debug session — findings

**Date:** 2026-08-19 · **Setup:** Vite harness (`npm run harness`) driven by an AI agent through Chrome browser-automation MCP tooling, calling `window.__RXJS_SPY__` via JavaScript evaluation — the workflow this library is built for. Two sessions were run: a smoke test of the harness streams, then a realistic sample pipeline.

## Sample pipeline under debug

Built live in the page (no app rebuild needed):

```
ui.keystrokes → debounceTime(200) → query.debounced
  → switchMap( flakyApi(q) + retry({ count: 3, delay: 80 }) )   // API fails twice, succeeds on 3rd attempt
  → search.results
```

The agent's session: `__RXJS_SPY__.help()` → `log("/^(ui|query|api|search)/")` → feed keystrokes → poll `logs({ sinceIndex })` → `snapshot({ match })`.

## Output 1 — retry saga as a value timeline

Typing `r`→`rx`→`rxj`→`rxjs` as a fast burst:

```
 0 ui.keystrokes    next  "r"
 1 ui.keystrokes    next  "rx"
 2 ui.keystrokes    next  "rxj"
 3 ui.keystrokes    next  "rxjs"
 4 query.debounced  next  "rxjs"                                  <- 4 keystrokes collapsed into 1 query
 5 api.retried      subscribe
 6 api.request      subscribe
 7 api.request      error  "HTTP 500 for \"rxjs\" (attempt 1)"
 8 api.request      subscribe                                     <- retry() resubscribing
 9 api.request      error  "HTTP 500 for \"rxjs\" (attempt 2)"
10 api.request      subscribe
11 api.request      next  {"query":"rxjs","hits":12,"attempt":3}  <- 3rd attempt succeeds
13 search.results   next  "\"rxjs\" -> 12 hits (after 3 attempts)"
```

## Output 2 — switchMap cancelling an in-flight retry

`"rxjs spy"` typed, then `"ngrx"` while the retry cycle was mid-flight:

```
17 query.debounced  next  "rxjs spy"
20 api.request      error  "HTTP 500 for \"rxjs spy\" (attempt 4)"
23 query.debounced  next  "ngrx"
24 api.retried      unsubscribe        <- switchMap kills the in-flight "rxjs spy" request
25 api.request      unsubscribe        <- ...and the cancellation reaches the source
28 api.request      error  "HTTP 500 for \"ngrx\" (attempt 5)"
30 api.request      next  {"query":"ngrx","hits":12,"attempt":6}
32 search.results   next  "\"ngrx\" -> 12 hits (after 3 attempts)"
```

## Output 3 — subscription graph snapshot

```
search.results [ACTIVE] next=2  values=["rxjs" -> 12 hits, "ngrx" -> 12 hits]
  query.debounced [ACTIVE] next=3  values=["rxjs","rxjs spy","ngrx"]
    ui.keystrokes [ACTIVE] next=6
    api.retried [unsubscribed] (flattened)      <- cancelled "rxjs spy" saga, correctly dead
      api.request [ERRORED]
        api.request [unsubscribed] (flattened)
    api.retried [completed] (flattened)         <- "ngrx" saga, completed
      api.request [ERRORED]
        api.request [completed]  values=[{query:"ngrx",hits:12,attempt:6}]

counts: { active: 7, closed: 21, records: 28 }
```

## Findings

1. **The MCP-first design works end to end.** Discovery (`help()`), graph inspection (`snapshot`), and incremental value tracing (`log` + `logs({ sinceIndex })` ring-buffer polling) all round-trip as JSON through the evaluate boundary — no `tap(console.log)` sprinkling, no console scraping.
2. **The smoke test caught a real interception bug** (since fixed in `5617deb`): operator-driven unsubscription (switchMap cancelling its inner) didn't tear down sources, because the spy's observer wrapping broke RxJS's subscriber `add()` teardown chain — a cancelled inner timer kept running and emitted a phantom value. Fix: when the caller passes its own `Subscriber`, `add()` the returned subscription to it. Regression test: "propagates operator-driven unsubscription" in `src/spy.test.ts`. Output 2 (entries 24–25) shows the corrected behavior live.
3. **The trace caught a bug in the sample app itself.** The app reported `"ngrx" -> ... (after 3 attempts)`, but the timeline proves ngrx succeeded on its **second** try (attempts 5→6) — the app's attempt-counting label was wrong. Exactly the class of discrepancy this tool exists to surface.
4. **Retention behaves as designed.** The first (`"rxjs"`) saga was auto-flushed from the snapshot once closed for longer than `keptDuration` (30 s); closed-but-recent records remain visible.
5. **Caveat — background-tab timer throttling.** With the page in an unfocused tab, Chrome aligns timers to ~1 s, so timings in traces stretch; notification *order* stays correct. Keep the tab focused (or expect coarse timing) when debugging timer-based streams.
