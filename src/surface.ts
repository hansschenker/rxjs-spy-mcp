import type { LogEntry } from "./log-plugin";
import { parseMatch } from "./match";
import { isClosed } from "./record";
import type { SerializeOptions } from "./serialize";
import type { SnapshotResult } from "./snapshot";
import type { LogHandle, Spy } from "./spy";

export interface SurfaceError {
  error: { message: string; name?: string };
}

export interface StatusResult {
  counts: {
    active: number;
    closed: number;
    logWrites: number;
    records: number;
  };
  hint: string;
  spying: boolean;
  tags: string[];
  tick: number;
  version: string;
}

export interface TagsResult {
  tags: {
    active: number;
    observableIds: number[];
    tag: string;
    total: number;
    totalNext: number;
  }[];
}

export interface LogsOptions {
  limit?: number;
  sinceIndex?: number;
}

export interface LogsResult {
  entries: (LogEntry & { index: number })[];
  nextIndex: number;
  note: string;
}

export interface SurfaceSnapshotOptions {
  includeStackTraces?: boolean;
  includeValues?: boolean;
  limit?: number;
  /** Tag string, "/regex/", observable id, or record id. */
  match?: string;
  serialize?: SerializeOptions;
}

export interface MethodDescriptor {
  description: string;
  example: string;
  name: string;
  signature: string;
}

export interface HelpResult {
  description: string;
  methods: MethodDescriptor[];
  name: string;
  version: string;
}

/**
 * The MCP-facing surface installed as a global (default `__RXJS_SPY__`).
 * Every method is synchronous, takes only JSON-plain arguments, and returns
 * JSON-serializable data, so it can be driven end-to-end through Chrome
 * DevTools MCP's evaluate tooling. Failures are returned as
 * `{ error: { message } }` rather than thrown.
 */
export interface SpySurface {
  activeLogs(): LogHandle[] | SurfaceError;
  flush(): { flushed: number } | SurfaceError;
  help(): HelpResult | SurfaceError;
  listTags(): TagsResult | SurfaceError;
  log(
    match?: string,
    options?: { console?: boolean },
  ): (LogHandle & { note: string }) | SurfaceError;
  logs(options?: LogsOptions): LogsResult | SurfaceError;
  snapshot(options?: SurfaceSnapshotOptions): SnapshotResult | SurfaceError;
  status(): StatusResult | SurfaceError;
  teardown(): { torndown: boolean } | SurfaceError;
  unlog(logId?: number): { removed: number } | SurfaceError;
}

function guard<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R | SurfaceError {
  return (...args: A) => {
    try {
      return fn(...args);
    } catch (error) {
      return {
        error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : undefined,
        },
      };
    }
  };
}

export function createSurface(spy: Spy): SpySurface {
  return {
    activeLogs: guard(() => spy.logs()),
    flush: guard(() => ({ flushed: spy.flush(true) })),
    help: guard(() => helpFor(spy)),
    listTags: guard((): TagsResult => {
      spy.flush();
      const byTag = new Map<
        string,
        { active: number; ids: Set<number>; total: number; totalNext: number }
      >();
      for (const record of spy.records()) {
        if (record.tag === undefined) {
          continue;
        }
        let entry = byTag.get(record.tag);
        if (!entry) {
          entry = { active: 0, ids: new Set(), total: 0, totalNext: 0 };
          byTag.set(record.tag, entry);
        }
        entry.ids.add(record.observableId);
        entry.total += 1;
        entry.totalNext += record.nextCount;
        if (!isClosed(record)) {
          entry.active += 1;
        }
      }
      return {
        tags: [...byTag.entries()].map(([tag, entry]) => ({
          active: entry.active,
          observableIds: [...entry.ids],
          tag,
          total: entry.total,
          totalNext: entry.totalNext,
        })),
      };
    }),
    log: guard((match?: string, options?: { console?: boolean }) => ({
      ...spy.log(match === undefined ? undefined : parseMatch(match), options),
      note: 'Notifications are buffered (poll with logs({ sinceIndex })) and written to the console with prefix "[rxjs-spy]".',
    })),
    logs: guard((options: LogsOptions = {}) => ({
      ...spy.logEntries(options.sinceIndex ?? 0, options.limit ?? 100),
      note: "Pass the returned nextIndex as sinceIndex in the next call for incremental reads.",
    })),
    snapshot: guard((options: SurfaceSnapshotOptions = {}) =>
      spy.snapshot({
        includeStackTraces: options.includeStackTraces,
        includeValues: options.includeValues,
        limit: options.limit,
        match: options.match === undefined ? undefined : parseMatch(options.match),
        serialize: options.serialize,
      }),
    ),
    status: guard((): StatusResult => {
      spy.flush();
      const records = spy.records();
      const active = records.filter((record) => !isClosed(record));
      const tags = [
        ...new Set(
          records
            .map((record) => record.tag)
            .filter((tag): tag is string => tag !== undefined),
        ),
      ];
      return {
        counts: {
          active: active.length,
          closed: records.length - active.length,
          logWrites: spy.logEntries(0, 0).nextIndex,
          records: records.length,
        },
        hint: "Call help() for the full method list; snapshot({ match }) for the subscription graph; log(match) + logs() to trace values.",
        spying: true,
        tags,
        tick: spy.tick,
        version: spy.version,
      };
    }),
    teardown: guard(() => {
      spy.teardown();
      return { torndown: true };
    }),
    unlog: guard((logId?: number) => ({ removed: spy.unlog(logId) })),
  };
}

export function installSurface(spy: Spy, globalName: string): () => void {
  const scope = globalThis as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(scope, globalName);
  const previous = scope[globalName];
  scope[globalName] = createSurface(spy);
  return () => {
    if (had) {
      scope[globalName] = previous;
    } else {
      delete scope[globalName];
    }
  };
}

function helpFor(spy: Spy): HelpResult {
  return {
    description:
      "rxjs-spy debugging surface. All methods are synchronous and return JSON-serializable data; drive them via Chrome DevTools MCP evaluate tooling, e.g. `__RXJS_SPY__.status()`. Tag observables in application code with tag('name') from rxjs-spy/operators to make them addressable.",
    methods: [
      {
        description: "This machine-readable method list.",
        example: "__RXJS_SPY__.help()",
        name: "help",
        signature: "help()",
      },
      {
        description:
          "Spy status: version, tick, record counts, and all known tags.",
        example: "__RXJS_SPY__.status()",
        name: "status",
        signature: "status()",
      },
      {
        description:
          "All tags with their observable ids and subscription counts.",
        example: "__RXJS_SPY__.listTags()",
        name: "listTags",
        signature: "listTags()",
      },
      {
        description:
          "Subscription graph snapshot. Roots are application subscribe calls; each node nests its upstream sources and includes state, latest values, and the subscribe-site stack trace. match: tag, '/regex/', observable id, or record id.",
        example: '__RXJS_SPY__.snapshot({ match: "search" })',
        name: "snapshot",
        signature:
          "snapshot({ match?, limit?, includeValues?, includeStackTraces? })",
      },
      {
        description:
          "Start logging notifications for matching observables (all when omitted). Returns a logId handle.",
        example: '__RXJS_SPY__.log("search")',
        name: "log",
        signature: "log(match?, { console? })",
      },
      {
        description:
          "Read buffered log entries incrementally; pass the returned nextIndex back as sinceIndex.",
        example: "__RXJS_SPY__.logs({ sinceIndex: 0 })",
        name: "logs",
        signature: "logs({ sinceIndex?, limit? })",
      },
      {
        description: "List active log handles.",
        example: "__RXJS_SPY__.activeLogs()",
        name: "activeLogs",
        signature: "activeLogs()",
      },
      {
        description: "Stop one log (or all when omitted).",
        example: "__RXJS_SPY__.unlog(1)",
        name: "unlog",
        signature: "unlog(logId?)",
      },
      {
        description: "Immediately drop records of closed subscriptions.",
        example: "__RXJS_SPY__.flush()",
        name: "flush",
        signature: "flush()",
      },
      {
        description:
          "Stop spying, restore Observable.prototype.subscribe, and remove this global.",
        example: "__RXJS_SPY__.teardown()",
        name: "teardown",
        signature: "teardown()",
      },
    ],
    name: "rxjs-spy",
    version: spy.version,
  };
}
