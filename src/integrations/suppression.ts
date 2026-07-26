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
const PUBLINT_TYPESCRIPT_CODES = new Set([
  "EXPORTS_TYPES_INVALID_FORMAT",
  "EXPORTS_TYPES_SHOULD_BE_FIRST",
  "FILE_DOES_NOT_EXIST",
  "FILE_NOT_PUBLISHED",
  "TYPES_NOT_EXPORTED",
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

function packageSpecifier(packageName: string, subpath: string): string {
  return subpath === "." ? packageName : `${packageName}/${subpath.slice(2)}`;
}

function evidenceHasResolutionFailure(
  diagnostic: Diagnostic,
  packageName: string,
): boolean {
  const specifier = packageSpecifier(packageName, diagnostic.subpath);
  return diagnostic.evidence
    .split("\n")
    .some(
      (line) =>
        /Cannot find (?:module|package)|Could not resolve/.test(line) &&
        (line.includes(`'${specifier}'`) || line.includes(`"${specifier}"`)),
    );
}

function detailStrings(value: JsonValue): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(detailStrings);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(detailStrings);
  }
  return [];
}

function evidenceHasFindingTarget(
  diagnostic: Diagnostic,
  finding: IncumbentFinding,
  packageName: string,
): boolean {
  if (
    finding.details === null ||
    Array.isArray(finding.details) ||
    typeof finding.details !== "object"
  ) {
    return false;
  }
  const target = (finding.details as { readonly [key: string]: JsonValue }).target;
  if (target === undefined) {
    return false;
  }
  const targets = detailStrings(target)
    .filter((value) => value.startsWith("./") && value.length > 2)
    .map((value) => `/node_modules/${packageName}${value.slice(1)}`);
  return diagnostic.evidence.split("\n").some((line) =>
    targets.some((target) => {
      let offset = line.indexOf(target);
      while (offset !== -1) {
        const next = line[offset + target.length];
        if (next === undefined || /['"\s):?#]/.test(next)) {
          return true;
        }
        offset = line.indexOf(target, offset + 1);
      }
      return false;
    }),
  );
}

function explains(
  diagnostic: Diagnostic,
  finding: IncumbentFinding,
  packageName: string,
): boolean {
  if (finding.subpath !== diagnostic.subpath) {
    return false;
  }
  if (diagnostic.code === "PC1001") {
    if (finding.tool === "publint") {
      return (
        PUBLINT_RUNTIME_CODES.has(finding.code) &&
        (evidenceHasResolutionFailure(diagnostic, packageName) ||
          evidenceHasFindingTarget(diagnostic, finding, packageName))
      );
    }
    return (
      ATTW_RUNTIME_CODES.has(finding.code) &&
      detailString(finding.details, "resolutionKind") ===
        expectedResolution(diagnostic) &&
      (finding.code === "CJSResolvesToESM"
        ? /ERR_REQUIRE_(?:ASYNC_MODULE|ESM)/.test(diagnostic.evidence)
        : evidenceHasResolutionFailure(diagnostic, packageName))
    );
  }
  if (diagnostic.code === "PC1002" && finding.tool === "publint") {
    return (
      PUBLINT_TYPESCRIPT_CODES.has(finding.code) &&
      (evidenceHasResolutionFailure(diagnostic, packageName) ||
        evidenceHasFindingTarget(diagnostic, finding, packageName))
    );
  }
  if (diagnostic.code === "PC1002" && finding.tool === "attw") {
    return (
      ATTW_TYPESCRIPT_CODES.has(finding.code) &&
      detailString(finding.details, "resolutionKind") ===
        expectedResolution(diagnostic) &&
      evidenceHasResolutionFailure(diagnostic, packageName)
    );
  }
  return false;
}

function explainDiagnostic(
  diagnostic: Diagnostic,
  findings: readonly IncumbentFinding[],
  packageName: string,
): Diagnostic {
  const explainedBy = [
    ...new Set(
      findings
        .filter((finding) => explains(diagnostic, finding, packageName))
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
  packageName: string,
): ProbeResult {
  if (result.state !== "fail") {
    return result;
  }
  const diagnostics = result.diagnostics.map((diagnostic) =>
    explainDiagnostic(diagnostic, findings, packageName),
  ) as [Diagnostic, ...Diagnostic[]];
  return Object.freeze({
    ...result,
    diagnostics: Object.freeze(diagnostics),
  });
}
