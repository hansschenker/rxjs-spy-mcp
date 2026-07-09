export interface SnapshotOptions {
  maxSerializedChars?: number;
  redactedKeys?: readonly string[];
}

const DEFAULT_MAX_SERIALIZED_CHARS = 4_000;
const DEFAULT_REDACTED_KEYS = [
  'password',
  'passphrase',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'setCookie'
] as const;

export function makeSafeSnapshot(value: unknown, options: SnapshotOptions = {}): unknown {
  const maxSerializedChars = options.maxSerializedChars ?? DEFAULT_MAX_SERIALIZED_CHARS;
  const redactedKeys = options.redactedKeys ?? DEFAULT_REDACTED_KEYS;

  const normalized = normalizeForSnapshot(value, new WeakSet<object>());
  const redacted = redactKeys(normalized, redactedKeys);
  const serialized = safeStringify(redacted);

  if (serialized.length <= maxSerializedChars) {
    return redacted;
  }

  return {
    __debugValueTruncated: true,
    originalSerializedLength: serialized.length,
    preview: serialized.slice(0, maxSerializedChars)
  };
}

function normalizeForSnapshot(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;
  if (typeof value !== 'object') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => normalizeForSnapshot(item, seen));
  }

  if (value instanceof Map) {
    return {
      __type: 'Map',
      entries: Array.from(value.entries()).map(([key, item]) => [
        normalizeForSnapshot(key, seen),
        normalizeForSnapshot(item, seen)
      ])
    };
  }

  if (value instanceof Set) {
    return {
      __type: 'Set',
      values: Array.from(value.values()).map(item => normalizeForSnapshot(item, seen))
    };
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = normalizeForSnapshot(item, seen);
  }

  return result;
}

function redactKeys(value: unknown, redactedKeys: readonly string[]): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(item => redactKeys(item, redactedKeys));
  }

  const redactedKeySet = new Set(redactedKeys.map(key => key.toLowerCase()));
  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    const shouldRedact = Array.from(redactedKeySet).some(redactedKey => normalizedKey.includes(redactedKey));
    result[key] = shouldRedact ? '[redacted]' : redactKeys(item, redactedKeys);
  }

  return result;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return String(value);
  }
}
