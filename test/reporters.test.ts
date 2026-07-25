import { describe, expect, it } from "vitest";
import { createDiagnostic } from "../src/core/diagnostic.js";
import type { PackageReport } from "../src/core/report.js";
import {
  renderGitHubReport,
  renderHumanComparison,
  renderHumanReport,
  serializeJsonReport,
} from "../src/index.js";

function report(withDiagnostic = true): PackageReport {
  const diagnostic = createDiagnostic({
    code: "PC1001",
    command: "node <consumer>/probe.mjs",
    evidence: "first line\n100%: second,line",
    explainedBy: null,
    profile: {
      moduleSystem: "esm",
      runtime: "24.16.0",
      typescriptResolution: null,
    },
    reproducible: false,
    severity: "error",
    sourceRange: {
      end: { column: 8, line: 2 },
      file: "package.json",
      start: { column: 3, line: 2 },
    },
    subpath: ".",
    title: "Package evaluation failed",
  });

  return {
    diagnostics: withDiagnostic ? [diagnostic] : [],
    environment: {
      architecture: "arm64",
      node: "24.16.0",
      npm: "12.0.1",
      platform: "darwin",
      profileSchema: 1,
      typescript: "7.0.2",
    },
    incumbentFindings: [],
    lockfileSha256: null,
    package: {
      files: [],
      name: "example",
      sha256: "0".repeat(64),
      version: "1.0.0",
    },
    results: [],
    tools: {
      attw: "0.18.5",
      publint: "0.3.22",
    },
  };
}

describe("reporters", () => {
  it("renders comparison regressions and inconclusive state", () => {
    const base = report();
    const diagnostic = base.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a diagnostic");
    }
    expect(
      renderHumanComparison({
        after: base.package,
        before: base.package,
        conclusive: false,
        fixes: [],
        inconclusiveReason: "dependency-graph-drift",
        regressions: [diagnostic],
        unchanged: [],
      }),
    ).toContain(
      "Comparison inconclusive: dependency graph drift.\n\nREGRESSION PC1001",
    );
  });

  it("is quiet for healthy human and GitHub reports", () => {
    expect(renderHumanReport(report(false))).toBe("");
    expect(renderGitHubReport(report(false))).toBe("");
  });

  it("renders concise human evidence", () => {
    expect(renderHumanReport(report())).toBe(
      [
        "PC1001 Package evaluation failed",
        "  . (ESM, Node 24.16.0)",
        "  $ node <consumer>/probe.mjs",
        "  first line",
        "  100%: second,line",
        "",
      ].join("\n"),
    );
  });

  it("escapes GitHub workflow commands and includes source positions", () => {
    expect(renderGitHubReport(report())).toBe(
      "::error title=PC1001 Package evaluation failed,file=package.json,line=2,col=3,endLine=2,endColumn=8::.: first line%0A100%25: second,line\n",
    );
  });

  it("serializes canonical byte-stable JSON with one trailing newline", () => {
    const first = serializeJsonReport(report());
    const second = serializeJsonReport(report());

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(first.indexOf('"diagnostics"')).toBeLessThan(first.indexOf('"environment"'));
  });
});
