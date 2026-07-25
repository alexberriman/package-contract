import type { Diagnostic } from "./diagnostic.js";
import type { PackageInput } from "./input.js";
import type { PackageReport } from "./report.js";
import { createTemporaryDirectory } from "./temporary.js";
import { type TestPackageOptions, testPackage } from "./test-package.js";

export interface UnchangedDiagnostic {
  readonly after: Diagnostic;
  readonly before: Diagnostic;
}

export interface ComparisonReport {
  readonly after: PackageReport["package"];
  readonly before: PackageReport["package"];
  readonly conclusive: boolean;
  readonly fixes: readonly Diagnostic[];
  readonly inconclusiveReason:
    | "dependency-graph-unavailable"
    | "dependency-graph-drift"
    | null;
  readonly regressions: readonly Diagnostic[];
  readonly unchanged: readonly UnchangedDiagnostic[];
}

export type ComparePackagesOptions = Omit<TestPackageOptions, "npmCachePath">;

function byId(diagnostics: readonly Diagnostic[]): ReadonlyMap<string, Diagnostic> {
  return new Map(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]));
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
    return Object.freeze({
      after: afterReport.package,
      before: beforeReport.package,
      conclusive: !graphUnavailable && !graphDrift,
      fixes,
      inconclusiveReason: graphUnavailable
        ? "dependency-graph-unavailable"
        : graphDrift
          ? "dependency-graph-drift"
          : null,
      regressions,
      unchanged,
    });
  } finally {
    await cache.cleanup();
  }
}
