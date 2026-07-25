import type { Diagnostic } from "../core/diagnostic.js";
import type { JsonValue } from "../core/manifest.js";
import { compareCodeUnits } from "../core/order.js";
import type { ProbeResult } from "../core/result.js";
import type { IncumbentFinding } from "./types.js";

const PUBLINT_RUNTIME_CODES = new Set([
  "FILE_DOES_NOT_EXIST",
  "FILE_INVALID_EXPLICIT_FORMAT",
  "FILE_INVALID_FORMAT",
  "FILE_NOT_PUBLISHED",
]);
const ATTW_RUNTIME_CODES = new Set(["CJSResolvesToESM", "NoResolution"]);
const ATTW_TYPESCRIPT_CODES = new Set([
  "CJSResolvesToESM",
  "FalseCJS",
  "FalseESM",
  "NoResolution",
  "UntypedResolution",
]);

function detailString(details: JsonValue, key: string): string | null {
  if (details !== null && !Array.isArray(details) && typeof details === "object") {
    const value = (details as { readonly [key: string]: JsonValue })[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}

function expectedResolution(diagnostic: Diagnostic): string {
  if (diagnostic.profile.typescriptResolution === "bundler") {
    return "bundler";
  }
  return diagnostic.profile.moduleSystem === "esm" ? "node16-esm" : "node16-cjs";
}

function explains(diagnostic: Diagnostic, finding: IncumbentFinding): boolean {
  if (finding.subpath !== diagnostic.subpath) {
    return false;
  }
  if (diagnostic.code === "PC1001") {
    if (finding.tool === "publint") {
      return PUBLINT_RUNTIME_CODES.has(finding.code);
    }
    return (
      ATTW_RUNTIME_CODES.has(finding.code) &&
      detailString(finding.details, "resolutionKind") === expectedResolution(diagnostic)
    );
  }
  if (diagnostic.code === "PC1002" && finding.tool === "attw") {
    return (
      ATTW_TYPESCRIPT_CODES.has(finding.code) &&
      detailString(finding.details, "resolutionKind") === expectedResolution(diagnostic)
    );
  }
  return false;
}

function explainDiagnostic(
  diagnostic: Diagnostic,
  findings: readonly IncumbentFinding[],
): Diagnostic {
  const explainedBy = [
    ...new Set(
      findings
        .filter((finding) => explains(diagnostic, finding))
        .map((finding) => `${finding.tool}:${finding.code}`),
    ),
  ].sort(compareCodeUnits);
  if (explainedBy.length === 0) {
    return diagnostic;
  }
  return Object.freeze({
    ...diagnostic,
    explainedBy: Object.freeze(explainedBy),
  });
}

export function applyIncumbentExplanations(
  result: ProbeResult,
  findings: readonly IncumbentFinding[],
): ProbeResult {
  if (result.state !== "fail") {
    return result;
  }
  const diagnostics = result.diagnostics.map((diagnostic) =>
    explainDiagnostic(diagnostic, findings),
  ) as [Diagnostic, ...Diagnostic[]];
  return Object.freeze({
    ...result,
    diagnostics: Object.freeze(diagnostics),
  });
}
