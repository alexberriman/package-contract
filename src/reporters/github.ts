import type { Diagnostic } from "../core/diagnostic.js";
import type { PackageReport } from "../core/report.js";

function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function annotation(diagnostic: Diagnostic): string {
  const properties = [
    `title=${escapeProperty(`${diagnostic.code} ${diagnostic.title}`)}`,
  ];
  if (diagnostic.sourceRange !== undefined) {
    properties.push(
      `file=${escapeProperty(diagnostic.sourceRange.file)}`,
      `line=${diagnostic.sourceRange.start.line}`,
      `col=${diagnostic.sourceRange.start.column}`,
      `endLine=${diagnostic.sourceRange.end.line}`,
      `endColumn=${diagnostic.sourceRange.end.column}`,
    );
  }
  const message = `${diagnostic.subpath}: ${diagnostic.evidence}`;
  return `::${diagnostic.severity} ${properties.join(",")}::${escapeData(message)}`;
}

export function renderGitHubReport(report: PackageReport): string {
  if (report.diagnostics.length === 0) {
    return "";
  }
  return `${report.diagnostics.map(annotation).join("\n")}\n`;
}
