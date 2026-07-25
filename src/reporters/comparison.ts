import type { ComparisonReport } from "../core/compare-packages.js";

export function renderHumanComparison(report: ComparisonReport): string {
  const sections: string[] = [];
  if (!report.conclusive) {
    sections.push(
      `Comparison inconclusive: ${report.inconclusiveReason?.replaceAll("-", " ") ?? "unknown reason"}.`,
    );
  }
  for (const diagnostic of report.regressions) {
    sections.push(
      `REGRESSION ${diagnostic.code} ${diagnostic.title}\n  ${diagnostic.subpath} (${diagnostic.profile.moduleSystem.toUpperCase()}, Node ${diagnostic.profile.runtime})`,
    );
  }
  for (const diagnostic of report.fixes) {
    sections.push(
      `FIX ${diagnostic.code} ${diagnostic.title}\n  ${diagnostic.subpath} (${diagnostic.profile.moduleSystem.toUpperCase()}, Node ${diagnostic.profile.runtime})`,
    );
  }
  return sections.length === 0 ? "" : `${sections.join("\n\n")}\n`;
}
