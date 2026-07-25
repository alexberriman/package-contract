import { Buffer } from "node:buffer";

import { DEFAULT_EVIDENCE_LIMIT_BYTES } from "./limits.js";

const ANSI_ESCAPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes begin with ESC.
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const UNSAFE_CONTROL_CHARACTERS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Control bytes are removed intentionally.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export interface NormalizeTextOptions {
  readonly limitBytes?: number;
  readonly redactions?: Readonly<Record<string, string>>;
}

function replaceAllLiteral(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function redactPaths(
  value: string,
  redactions: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(redactions)
    .filter(([path]) => path.length > 0)
    .sort(([left], [right]) => right.length - left.length);

  let result = value;
  for (const [path, replacement] of entries) {
    const normalizedPath = path.replaceAll("\\", "/");
    result = replaceAllLiteral(result, normalizedPath, replacement);
  }
  return result;
}

function truncateUtf8(value: string, limitBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= limitBytes) {
    return value;
  }

  const suffix = "\n<truncated>";
  const suffixBytes = Buffer.byteLength(suffix);
  if (limitBytes <= suffixBytes) {
    return suffix.slice(0, limitBytes);
  }
  const contentLimit = Math.max(0, limitBytes - suffixBytes);
  let truncated = buffer.subarray(0, contentLimit).toString("utf8");

  while (Buffer.byteLength(truncated) > contentLimit) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}${suffix}`;
}

export function normalizeText(
  input: string,
  options: NormalizeTextOptions = {},
): string {
  const limitBytes = options.limitBytes ?? DEFAULT_EVIDENCE_LIMIT_BYTES;
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
    throw new RangeError("limitBytes must be a non-negative safe integer");
  }

  const normalized = input
    .replace(ANSI_ESCAPE, "")
    .replace(/\r\n?/g, "\n")
    .replaceAll("\\", "/")
    .replace(UNSAFE_CONTROL_CHARACTERS, "");
  const redacted = redactPaths(normalized, options.redactions ?? {});
  return truncateUtf8(redacted.trim(), limitBytes);
}
