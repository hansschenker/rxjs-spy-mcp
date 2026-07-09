# rxjs-spy-mcp

Experimental **RxJS runtime debugging** prototype for **Chrome DevTools MCP**.

This repository modernizes the idea behind Nicholas Jamieson's `rxjs-spy` for an AI-assisted debugging workflow: RxJS runtime events are captured into a structured heap registry, exposed through a small debug API, and made readable by Chrome DevTools MCP agents.

## Main contributor note

**ChatGPT is the main contributor to this project.**

The architecture, TypeScript starter implementation, RxJS custom debug operators, MVU demo, time-travel heap registry, and Chrome DevTools MCP bridge were generated and refined with ChatGPT from the user's RxJS debugging requirements.

## Project goal

The goal is not to replace `rxjs-spy` completely yet. This is a first experimental implementation of an MCP-friendly RxJS debugging model.

The current prototype focuses on:

- typed RxJS debug operators
- an Elm-like MVU demo
- time-travel state history
- passive heap-based inspection
- safe snapshotting and redaction
- Chrome DevTools third-party tool discovery
- AI-readable debug frames

The long-term direction is a modern `rxjs-spy-mcp` runtime that can inspect:

- tagged streams
- notifications: `next`, `error`, `complete`
- subscriptions and unsubscriptions
- MVU transitions: `Msg -> Model`
- inner subscription behavior from `switchMap`, `mergeMap`, `concatMap`, `exhaustMap`
- scheduler-aware timing traces

## Mental model

```text
Observable      = static dataflow description
Subscription    = runtime execution
Notification    = runtime event: next | error | complete
Scheduler       = runtime time policy
Heap registry   = durable debug memory
Chrome MCP      = AI-readable inspection bridge
```

The debugger turns fast asynchronous RxJS events into durable debug frames:

```text
Msg / next / error / complete / unsubscribe
        ↓
spyOnHeap / spyOnMvuLoop
        ↓
window.__RXJS_SPY_MCP__
        ↓
Chrome DevTools MCP / console / debug panel
```

## Installation

```bash
npm install
```

## Run the demo

```bash
npm run dev
```

Open the local Vite URL printed in the terminal, usually:

```text
http://127.0.0.1:5173
```

## Sample: using the debug feature manually

1. Start the app with `npm run dev`.
2. Open the browser DevTools console.
3. Type a search query, for example `rxjs`, and press **Search**.
4. Inspect the tracked streams:

```js
window.__RXJS_SPY_MCP__.listStreams()
```

5. Inspect the main MVU state stream:

```js
window.__RXJS_SPY_MCP__.inspectStream('main-app-state')
```

6. Read only the timeline frames:

```js
window.__RXJS_SPY_MCP__.getTimeline('main-app-state', 10)
```

7. Simulate a failing async effect by typing:

```text
error
```

Then press **Search**.

8. Inspect the timeline again:

```js
window.__RXJS_SPY_MCP__.getTimeline('main-app-state', 20)
```

You should see a sequence similar to:

```text
INIT
SET_QUERY
START_SEARCH
SEARCH_FAILURE
```

Each `mvu-transition` frame stores:

```ts
{
  action: Msg,
  resultingState: Model
}
```

This gives a readable runtime story:

```text
The user changed the query.
A search request started.
The async effect failed.
The model moved into an error state.
The view rendered the error.
```

## Sample: visual time-travel

The debug panel on the right shows the heap timeline.

Click any frame to visually rewind the UI to the `resultingState` stored in that frame.

You can also jump from the DevTools console:

```js
window.jumpToStep(2)
```

Important: this is currently **visual rewind**, not full replay-based state restoration. The internal `scan` accumulator is not rewound. A future version can add true event replay.

## Sample: using the custom operators

### Generic stream inspection

```ts
import { interval, map, take } from 'rxjs';
import { spyOnHeap } from './debug/operators';

const counter$ = interval(1000).pipe(
  take(5),
  map(n => ({ count: n })),
  spyOnHeap('counter-stream', { maxFrames: 10 })
);

counter$.subscribe();
```

Then inspect it in the console:

```js
window.__RXJS_SPY_MCP__.inspectStream('counter-stream')
```

### MVU transition inspection

```ts
const transition$ = msg$.pipe(
  scan(
    (acc, msg) => ({ msg, model: update(acc.model, msg) }),
    { msg: { type: 'INIT' }, model: initialModel }
  ),
  spyOnMvuLoop('main-app-state', { maxFrames: 80 })
);
```

This is the key teaching/debugging use case:

```text
Msg flows in over time.
update calculates the next Model.
spyOnMvuLoop stores Msg + Model as a debug frame.
```

## Sample: Chrome DevTools MCP workflow

This project registers a Chrome DevTools third-party developer tools bridge through the page-level `devtoolstooldiscovery` event.

When Chrome DevTools MCP is connected with the experimental third-party tools category enabled, an AI agent can discover tools such as:

```text
rxjs_list_streams
rxjs_inspect_stream
rxjs_get_timeline
```

A typical AI-agent prompt:

```text
Inspect the active browser tab with Chrome DevTools MCP. Use the rxjs-spy-mcp tools to list RxJS streams, read the main-app-state timeline, and explain why the latest search failed.
```

Expected agent behavior:

```text
1. list_3p_developer_tools
2. execute_3p_developer_tool: rxjs_list_streams
3. execute_3p_developer_tool: rxjs_get_timeline { tag: 'main-app-state', limit: 20 }
4. Explain the Msg -> Model transition that caused the bad state.
```

A fallback MCP approach is script evaluation:

```js
() => globalThis.__RXJS_SPY_MCP__.getTimeline('main-app-state', 20)
```

## Corrections applied to the original prototype

| Dimension | Correction applied |
|---|---|
| Concept | Reframed MCP as an inspection bridge, not a replacement for RxJS runtime instrumentation. |
| MVU time-travel teaching value | Added explicit `Msg -> Model` transition tracking and a visual timeline panel. |
| TypeScript correctness | Split app and debug types, fixed invalid imports, removed `any`-based `INITIALIZE`, added strict typed operators. |
| Chrome MCP API correctness | Replaced the invented `navigator.developerTools.registerTool` idea with a `devtoolstooldiscovery` bridge for Chrome DevTools third-party tools. |
| rxjs-spy replacement completeness | Added a foundation for tagged streams, notification frames, subscription IDs, teardown tracking, and stream summaries. Still not a full rxjs-spy replacement. |
| AI-agent usability | Added JSON-friendly `listStreams`, `inspectStream`, and `getTimeline` methods. |
| Production safety | Dev-only installation, redaction for secret-like keys, safe snapshot serialization, circular-value tolerance, and size-limited snapshots. |

## Current limitations

This is an experimental prototype. It does not yet implement full rxjs-spy behavior.

Missing or future work:

- monkey-patch-free tagging API comparable to `rxjs-spy` tags
- global Observable subscription graph
- parent/child subscription graph
- higher-order operator visualization
- dedicated debug operators for `switchMap`, `mergeMap`, `concatMap`, `exhaustMap`
- scheduler-aware traces for `asyncScheduler`, `animationFrameScheduler`, virtual time, and drift
- true replay-based time travel
- tests
- package publishing

## Safety notes

The debug registry exposes runtime state on `window.__RXJS_SPY_MCP__` in development mode. Do not expose sensitive production data through debug streams.

The snapshot layer redacts common secret-like keys and limits serialized payload size, but this is not a complete security boundary.

## License

MIT
