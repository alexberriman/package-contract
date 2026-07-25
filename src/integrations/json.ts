import type { JsonValue } from "../core/manifest.js";
import { compareCodeUnits } from "../core/order.js";

export function toCanonicalJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => toCanonicalJson(child));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, child]) => [key, toCanonicalJson(child)] as const);
    return Object.fromEntries(entries);
  }
  return String(value);
}
