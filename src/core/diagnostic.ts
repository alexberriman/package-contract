import { createHash } from "node:crypto";

import { DIAGNOSTIC_ID_HEX_LENGTH } from "./limits.js";
import { compareCodeUnits } from "./order.js";
import { type NormalizeTextOptions, normalizeText } from "./text.js";

export type DiagnosticSeverity = "error" | "warning";

export interface FilePosition {
  readonly column: number;
  readonly line: number;
}

export interface FileRange {
  readonly end: FilePosition;
  readonly file: string;
  readonly start: FilePosition;
}

export interface ConsumerProfileId {
  readonly moduleSystem: "cjs" | "esm";
  readonly runtime: string;
  readonly typescriptResolution: "bundler" | "node16" | "nodenext" | null;
}

export interface Diagnostic {
  readonly code: string;
  readonly command: string;
  readonly evidence: string;
  readonly explainedBy: readonly string[] | null;
  readonly id: string;
  readonly profile: ConsumerProfileId;
  readonly reproducible: boolean;
  readonly severity: DiagnosticSeverity;
  readonly sourceRange?: FileRange;
  readonly subpath: string;
  readonly title: string;
}

export interface DiagnosticInput
  extends Omit<Diagnostic, "command" | "evidence" | "id"> {
  readonly command: string;
  readonly evidence: string;
}

export interface CreateDiagnosticOptions extends NormalizeTextOptions {}

const DIAGNOSTIC_CODE = /^PC\d{4}$/;
const DOMAIN_SEPARATOR = "package-contract:diagnostic:v1\u0000";
const EXPLANATION = /^(?:attw|publint):[A-Za-z0-9_-]+$/;
const RUNTIME_VERSION = /^\d+(?:\.\d+){0,2}$/;

function isSafeRelativePath(path: string): boolean {
  const segments = path.split("/");
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Public paths reject control bytes.
    !/[\u0000-\u001F\u007F]/.test(path) &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function canonicalIdentity(input: DiagnosticInput): string {
  return JSON.stringify([
    input.code,
    input.profile.moduleSystem,
    input.profile.runtime,
    input.profile.typescriptResolution,
    input.subpath,
  ]);
}

function validateDiagnostic(input: DiagnosticInput): void {
  if (!DIAGNOSTIC_CODE.test(input.code)) {
    throw new TypeError("diagnostic code must match PC followed by four digits");
  }
  if (input.subpath !== "." && !input.subpath.startsWith("./")) {
    throw new TypeError('diagnostic subpath must be "." or begin with "./"');
  }
  if (input.subpath !== "." && !isSafeRelativePath(input.subpath.slice(2))) {
    throw new TypeError("diagnostic subpath contains unsafe path segments");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Public titles reject control bytes.
  if (input.title.trim().length === 0 || /[\u0000-\u001F\u007F]/.test(input.title)) {
    throw new TypeError("diagnostic title must not be empty");
  }
  if (input.command.trim().length === 0 || input.evidence.trim().length === 0) {
    throw new TypeError("diagnostic command and evidence must not be empty");
  }
  if (!RUNTIME_VERSION.test(input.profile.runtime)) {
    throw new TypeError("diagnostic runtime version is invalid");
  }
  if (
    input.profile.moduleSystem === "cjs" &&
    input.profile.typescriptResolution === "bundler"
  ) {
    throw new TypeError("bundler resolution is not valid for CommonJS");
  }
  if (
    input.explainedBy?.some((explanation) => !EXPLANATION.test(explanation)) === true
  ) {
    throw new TypeError("diagnostic explanation is invalid");
  }
  if (input.sourceRange !== undefined) {
    if (!isSafeRelativePath(input.sourceRange.file)) {
      throw new TypeError("diagnostic source file must be a safe relative path");
    }
    for (const position of [input.sourceRange.start, input.sourceRange.end]) {
      if (
        !Number.isSafeInteger(position.line) ||
        !Number.isSafeInteger(position.column) ||
        position.line < 1 ||
        position.column < 1
      ) {
        throw new TypeError("diagnostic source positions must be positive integers");
      }
    }
  }
}

export function createDiagnostic(
  input: DiagnosticInput,
  options: CreateDiagnosticOptions = {},
): Diagnostic {
  validateDiagnostic(input);
  const id = createHash("sha256")
    .update(DOMAIN_SEPARATOR)
    .update(canonicalIdentity(input))
    .digest("hex")
    .slice(0, DIAGNOSTIC_ID_HEX_LENGTH);

  const sourceRange =
    input.sourceRange === undefined
      ? {}
      : {
          sourceRange: Object.freeze({
            ...input.sourceRange,
            end: Object.freeze({ ...input.sourceRange.end }),
            start: Object.freeze({ ...input.sourceRange.start }),
          }),
        };

  return Object.freeze({
    ...input,
    ...sourceRange,
    command: normalizeText(input.command, options),
    evidence: normalizeText(input.evidence, options),
    explainedBy:
      input.explainedBy === null
        ? null
        : Object.freeze([...new Set(input.explainedBy)].sort(compareCodeUnits)),
    id,
    profile: Object.freeze({ ...input.profile }),
  });
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.profile.runtime, right.profile.runtime) ||
    compareCodeUnits(left.profile.moduleSystem, right.profile.moduleSystem) ||
    compareCodeUnits(
      left.profile.typescriptResolution ?? "",
      right.profile.typescriptResolution ?? "",
    ) ||
    compareCodeUnits(left.subpath, right.subpath) ||
    compareCodeUnits(left.id, right.id)
  );
}
