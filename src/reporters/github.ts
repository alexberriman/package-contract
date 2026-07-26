import type { Diagnostic } from "../core/diagnostic.js";
import type { PackageReport } from "../core/report.js";

const ANNOTATION_LIMIT = 50;
const REPORT_LIMIT_BYTES = 256 * 1024;

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
  const lines: string[] = [];
  let bytes = 0;
  for (const diagnostic of report.diagnostics.slice(0, ANNOTATION_LIMIT)) {
    const line = annotation(diagnostic);
    const lineBytes = Buffer.byteLength(`${line}\n`);
    if (bytes + lineBytes > REPORT_LIMIT_BYTES) {
      break;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  const omitted = report.diagnostics.length - lines.length;
  if (omitted > 0) {
    const summary = `package-contract omitted ${omitted} additional annotation${omitted === 1 ? "" : "s"} from workflow output; use the JSON reporter for the complete result.`;
    if (bytes + Buffer.byteLength(`${summary}\n`) <= REPORT_LIMIT_BYTES) {
      lines.push(summary);
    }
  }
  return `${lines.join("\n")}\n`;
}
