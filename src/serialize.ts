import { Observable, Subscription } from "rxjs";
import { identify } from "./identify";
import { getTag } from "./metadata";

export interface SerializeOptions {
  maxArrayLength?: number;
  maxDepth?: number;
  maxProperties?: number;
  maxStringLength?: number;
  /**
   * Property keys to redact (case-insensitive substring match, so "token"
   * also catches "accessToken"). Defaults to DEFAULT_REDACT_KEYS; pass []
   * to disable redaction.
   */
  redactKeys?: readonly string[];
}

/**
 * Keys whose values are redacted by default. Spy output is designed to be
 * read by AI agents over an MCP boundary, so secrets must never leave the
 * page in traces. Ported from the rxjs-spy-mcp-old prototype.
 */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "passphrase",
  "password",
  "secret",
  "token",
];

/**
 * Converts an arbitrary runtime value into a JSON-safe representation with
 * bounded size: circular references, functions, observables, errors, DOM
 * elements etc. become short descriptive strings; strings, arrays and
 * objects are truncated. The result always survives JSON.stringify - this
 * is what makes spy output transportable over an MCP evaluate boundary.
 */
export function toSerializable(
  value: unknown,
  options: SerializeOptions = {},
): unknown {
  const maxArrayLength = options.maxArrayLength ?? 10;
  const maxDepth = options.maxDepth ?? 3;
  const maxProperties = options.maxProperties ?? 20;
  const maxStringLength = options.maxStringLength ?? 200;
  const redactKeys = (options.redactKeys ?? DEFAULT_REDACT_KEYS).map((key) =>
    key.toLowerCase(),
  );
  const shouldRedact = (key: string): boolean => {
    const lowered = key.toLowerCase();
    return redactKeys.some((redactKey) => lowered.includes(redactKey));
  };
  const seen = new WeakSet<object>();

  const serialize = (input: unknown, depth: number): unknown => {
    switch (typeof input) {
      case "string":
        return input.length > maxStringLength
          ? `${input.slice(0, maxStringLength)}... (+${input.length - maxStringLength} chars)`
          : input;
      case "number":
        return Number.isFinite(input) ? input : String(input);
      case "boolean":
        return input;
      case "bigint":
        return `${input}n`;
      case "function":
        return input.name ? `[Function: ${input.name}]` : "[Function]";
      case "symbol":
        return input.toString();
      case "undefined":
        return "[undefined]";
    }
    if (input === null) {
      return null;
    }
    const target = input as object;
    if (target instanceof Observable) {
      const tag = getTag(target);
      return `[Observable #${identify(target)}${tag === undefined ? "" : ` tag=${tag}`}]`;
    }
    if (target instanceof Subscription) {
      return "[Subscription]";
    }
    if (target instanceof Date) {
      return target.toISOString();
    }
    if (target instanceof RegExp) {
      return target.toString();
    }
    if (target instanceof Error) {
      return {
        message: target.message,
        name: target.name,
        stack: target.stack
          ?.split("\n")
          .slice(0, 4)
          .map((line) => line.trim()),
      };
    }
    if (target instanceof Map) {
      return `[Map size=${target.size}]`;
    }
    if (target instanceof Set) {
      return `[Set size=${target.size}]`;
    }
    if (typeof Element !== "undefined" && target instanceof Element) {
      return `[Element <${target.tagName.toLowerCase()}>]`;
    }
    if (seen.has(target)) {
      return "[Circular]";
    }
    if (depth >= maxDepth) {
      return Array.isArray(target)
        ? `[Array length=${target.length}]`
        : `[Object ${target.constructor?.name ?? "?"}]`;
    }
    seen.add(target);
    try {
      if (Array.isArray(target)) {
        const result: unknown[] = target
          .slice(0, maxArrayLength)
          .map((item) => serialize(item, depth + 1));
        if (target.length > maxArrayLength) {
          result.push(`... (+${target.length - maxArrayLength} more)`);
        }
        return result;
      }
      const entries = Object.entries(target as Record<string, unknown>);
      const result: Record<string, unknown> = {};
      for (const [key, item] of entries.slice(0, maxProperties)) {
        result[key] = shouldRedact(key)
          ? "[Redacted]"
          : serialize(item, depth + 1);
      }
      if (entries.length > maxProperties) {
        result["..."] = `+${entries.length - maxProperties} more properties`;
      }
      return result;
    } finally {
      seen.delete(target);
    }
  };

  return serialize(value, 0);
}
