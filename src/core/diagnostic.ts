import { createHash } from "node:crypto";

import { DIAGNOSTIC_ID_HEX_LENGTH } from "./limits.js";
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
  if (input.title.trim().length === 0) {
    throw new TypeError("diagnostic title must not be empty");
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
        : Object.freeze([...new Set(input.explainedBy)].sort()),
    id,
    profile: Object.freeze({ ...input.profile }),
  });
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    left.code.localeCompare(right.code) ||
    left.profile.runtime.localeCompare(right.profile.runtime) ||
    left.profile.moduleSystem.localeCompare(right.profile.moduleSystem) ||
    (left.profile.typescriptResolution ?? "").localeCompare(
      right.profile.typescriptResolution ?? "",
    ) ||
    left.subpath.localeCompare(right.subpath) ||
    left.id.localeCompare(right.id)
  );
}
