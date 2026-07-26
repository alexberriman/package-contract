import { describe, expect, it } from "vitest";
import { createDiagnostic } from "../src/core/diagnostic.js";
import type { PackageReport } from "../src/core/report.js";
import { renderHumanComparison } from "../src/reporters/comparison.js";
import { renderGitHubReport } from "../src/reporters/github.js";
import { renderHumanReport } from "../src/reporters/human.js";
import { serializeJson, serializeJsonReport } from "../src/reporters/json.js";

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
    actions: [],
    bins: [],
    diagnostics: withDiagnostic ? [diagnostic] : [],
    environment: {
      architecture: "arm64",
      npm: "12.0.1",
      platform: "darwin",
      profileSchema: 1,
      runnerNode: "24.16.0",
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
        afterResults: [],
        before: base.package,
        beforeResults: [],
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

  it("renders fixes and remains quiet for a conclusive unchanged comparison", () => {
    const base = report();
    const diagnostic = base.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a diagnostic");
    }
    expect(
      renderHumanComparison({
        after: base.package,
        afterResults: [],
        before: base.package,
        beforeResults: [],
        conclusive: true,
        fixes: [diagnostic],
        inconclusiveReason: null,
        regressions: [],
        unchanged: [],
      }),
    ).toContain("FIX PC1001 Package evaluation failed");
    expect(
      renderHumanComparison({
        after: base.package,
        afterResults: [],
        before: base.package,
        beforeResults: [],
        conclusive: true,
        fixes: [],
        inconclusiveReason: null,
        regressions: [],
        unchanged: [],
      }),
    ).toBe("");
  });

  it("uses a stable fallback for an unexplained inconclusive comparison", () => {
    const base = report(false);
    expect(
      renderHumanComparison({
        after: base.package,
        afterResults: [],
        before: base.package,
        beforeResults: [],
        conclusive: false,
        fixes: [],
        inconclusiveReason: null,
        regressions: [],
        unchanged: [],
      }),
    ).toBe("Comparison inconclusive: unknown reason.\n");
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

  it("includes the TypeScript resolution in human profile labels", () => {
    const base = report();
    const diagnostic = base.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a diagnostic");
    }
    expect(
      renderHumanReport({
        ...base,
        diagnostics: [
          {
            ...diagnostic,
            profile: {
              ...diagnostic.profile,
              typescriptResolution: "bundler",
            },
          },
        ],
      }),
    ).toContain("(ESM, Node 24.16.0, TypeScript bundler)");
  });

  it("escapes GitHub workflow commands and includes source positions", () => {
    expect(renderGitHubReport(report())).toBe(
      "::error title=PC1001 Package evaluation failed,file=package.json,line=2,col=3,endLine=2,endColumn=8::.: first line%0A100%25: second,line\n",
    );
  });

  it("bounds GitHub annotation count and reports omissions", () => {
    const base = report();
    const diagnostic = base.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a diagnostic");
    }
    const diagnostics = Array.from({ length: 60 }, (_, index) => ({
      ...diagnostic,
      id: index.toString(16).padStart(16, "0"),
    }));
    const output = renderGitHubReport({ ...base, diagnostics });

    expect(output.match(/^::error /gm)).toHaveLength(50);
    expect(output).toContain(
      "package-contract omitted 10 additional annotations from workflow output",
    );
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(256 * 1024);
  });

  it("renders annotations without optional source positions", () => {
    const base = report();
    const diagnostic = base.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a diagnostic");
    }
    const { sourceRange: _sourceRange, ...withoutSourceRange } = diagnostic;
    expect(
      renderGitHubReport({
        ...base,
        diagnostics: [
          {
            ...withoutSourceRange,
            severity: "warning",
          },
        ],
      }),
    ).toBe(
      "::warning title=PC1001 Package evaluation failed::.: first line%0A100%25: second,line\n",
    );
  });

  it("serializes canonical byte-stable JSON with one trailing newline", () => {
    const first = serializeJsonReport(report());
    const second = serializeJsonReport(report());

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(first.indexOf('"diagnostics"')).toBeLessThan(first.indexOf('"environment"'));
  });

  it("canonicalizes generated object insertion orders recursively", () => {
    const entries = [
      ["z", { beta: 2, alpha: 1 }],
      ["a", [{ delta: 4, charlie: 3 }]],
      ["m", true],
    ] as const;

    for (const order of [
      entries,
      [...entries].reverse(),
      [entries[1], entries[2], entries[0]],
    ]) {
      expect(serializeJson(Object.fromEntries(order))).toMatchInlineSnapshot(`
        "{
          "a": [
            {
              "charlie": 3,
              "delta": 4
            }
          ],
          "m": true,
          "z": {
            "alpha": 1,
            "beta": 2
          }
        }
        "
      `);
    }
  });
});
