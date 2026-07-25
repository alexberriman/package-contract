import type { Diagnostic } from "../core/diagnostic.js";
import type { PackageReport } from "../core/report.js";

function profileLabel(diagnostic: Diagnostic): string {
  const typescript =
    diagnostic.profile.typescriptResolution === null
      ? ""
      : `, TypeScript ${diagnostic.profile.typescriptResolution}`;
  return `${diagnostic.profile.moduleSystem.toUpperCase()}, Node ${diagnostic.profile.runtime}${typescript}`;
}

export function renderHumanReport(report: PackageReport): string {
  if (report.diagnostics.length === 0) {
    return "";
  }
  return `${report.diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.code} ${diagnostic.title}\n  ${diagnostic.subpath} (${profileLabel(diagnostic)})\n  $ ${diagnostic.command}\n  ${diagnostic.evidence.replaceAll("\n", "\n  ")}`,
    )
    .join("\n\n")}\n`;
}
