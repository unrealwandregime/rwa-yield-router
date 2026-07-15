import { createHash } from "node:crypto";

function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Idempotency inputs cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => canonicalize(entry)).join(",") + "]";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => JSON.stringify(key) + ":" + canonicalize(entry));
    return "{" + entries.join(",") + "}";
  }
  throw new TypeError("Idempotency inputs must be JSON-compatible");
}

export function createIdempotencyKey(namespace: string, input: unknown): string {
  if (namespace.trim() === "") {
    throw new TypeError("Idempotency namespace must not be empty");
  }
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(canonicalize(input))
    .digest("hex");
  return namespace + ":" + digest;
}

export interface IdempotencyStore {
  begin(key: string, ttlSeconds: number): Promise<"ACQUIRED" | "IN_PROGRESS" | "COMPLETED">;
  complete(key: string): Promise<void>;
  release(key: string): Promise<void>;
}

export async function runIdempotently<T>(
  store: IdempotencyStore,
  key: string,
  ttlSeconds: number,
  operation: () => Promise<T>
): Promise<
  | Readonly<{ status: "COMPLETED"; value: T }>
  | Readonly<{ status: "DUPLICATE_IN_PROGRESS" | "DUPLICATE_COMPLETED" }>
> {
  const result = await store.begin(key, ttlSeconds);
  if (result === "IN_PROGRESS") {
    return { status: "DUPLICATE_IN_PROGRESS" };
  }
  if (result === "COMPLETED") {
    return { status: "DUPLICATE_COMPLETED" };
  }
  try {
    const value = await operation();
    await store.complete(key);
    return { status: "COMPLETED", value };
  } catch (error) {
    await store.release(key);
    throw error;
  }
}
