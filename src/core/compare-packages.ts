import type { Diagnostic } from "./diagnostic.js";
import type { PackageInput } from "./input.js";
import type { PackageReport } from "./report.js";
import type { ProbeResult } from "./result.js";
import { createTemporaryDirectory } from "./temporary.js";
import { type TestPackageOptions, testPackage } from "./test-package.js";

export interface UnchangedDiagnostic {
  readonly after: Diagnostic;
  readonly before: Diagnostic;
}

export interface ComparisonReport {
  readonly after: PackageReport["package"];
  readonly afterResults: readonly ProbeResult[];
  readonly before: PackageReport["package"];
  readonly beforeResults: readonly ProbeResult[];
  readonly conclusive: boolean;
  readonly fixes: readonly Diagnostic[];
  readonly inconclusiveReason:
    | "dependency-graph-unavailable"
    | "dependency-graph-drift"
    | "evaluation-coverage-drift"
    | null;
  readonly regressions: readonly Diagnostic[];
  readonly unchanged: readonly UnchangedDiagnostic[];
}

export type ComparePackagesOptions = Omit<TestPackageOptions, "npmCachePath">;

function byId(diagnostics: readonly Diagnostic[]): ReadonlyMap<string, Diagnostic> {
  return new Map(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]));
}

function resultKey(result: ProbeResult): string {
  return JSON.stringify([result.subpath, result.profile]);
}

function evaluationClass(result: ProbeResult): string {
  return result.state === "not-evaluated"
    ? `not-evaluated:${result.reason.code}`
    : "evaluated";
}

function hasEvaluationCoverageDrift(
  before: readonly ProbeResult[],
  after: readonly ProbeResult[],
): boolean {
  const afterByKey = new Map(after.map((result) => [resultKey(result), result]));
  if (before.length !== after.length) {
    return true;
  }
  return before.some((result) => {
    const matching = afterByKey.get(resultKey(result));
    return (
      matching === undefined || evaluationClass(matching) !== evaluationClass(result)
    );
  });
}

export async function comparePackages(
  beforeInput: PackageInput,
  afterInput: PackageInput,
  options: ComparePackagesOptions = {},
): Promise<ComparisonReport> {
  const cache = await createTemporaryDirectory("package-contract-compare-cache-");
  try {
    const beforeReport = await testPackage(beforeInput, {
      ...options,
      npmCachePath: cache.path,
    });
    const afterReport = await testPackage(afterInput, {
      ...options,
      npmCachePath: cache.path,
      offline: true,
    });
    const before = byId(beforeReport.diagnostics);
    const after = byId(afterReport.diagnostics);
    const regressions = Object.freeze(
      afterReport.diagnostics.filter(({ id }) => !before.has(id)),
    );
    const fixes = Object.freeze(
      beforeReport.diagnostics.filter(({ id }) => !after.has(id)),
    );
    const unchanged = Object.freeze(
      beforeReport.diagnostics.flatMap((diagnostic) => {
        const matching = after.get(diagnostic.id);
        return matching === undefined
          ? []
          : [
              Object.freeze({
                after: matching,
                before: diagnostic,
              }),
            ];
      }),
    );
    const graphUnavailable =
      beforeReport.lockfileSha256 === null || afterReport.lockfileSha256 === null;
    const graphDrift =
      !graphUnavailable && beforeReport.lockfileSha256 !== afterReport.lockfileSha256;
    const coverageDrift = hasEvaluationCoverageDrift(
      beforeReport.results,
      afterReport.results,
    );
    return Object.freeze({
      after: afterReport.package,
      afterResults: afterReport.results,
      before: beforeReport.package,
      beforeResults: beforeReport.results,
      conclusive: !graphUnavailable && !graphDrift && !coverageDrift,
      fixes,
      inconclusiveReason: graphUnavailable
        ? "dependency-graph-unavailable"
        : graphDrift
          ? "dependency-graph-drift"
          : coverageDrift
            ? "evaluation-coverage-drift"
            : null,
      regressions,
      unchanged,
    });
  } finally {
    await cache.cleanup();
  }
}
