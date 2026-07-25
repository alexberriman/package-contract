import { describe, expect, it } from "vitest";

import {
  compareDiagnostics,
  createDiagnostic,
  type DiagnosticInput,
} from "../src/index.js";

function diagnostic(overrides: Partial<DiagnosticInput> = {}): DiagnosticInput {
  return {
    code: "PC1001",
    command: "node <consumer>/probe.mjs",
    evidence: "failure",
    explainedBy: null,
    profile: {
      moduleSystem: "esm",
      runtime: "24.16.0",
      typescriptResolution: "nodenext",
    },
    reproducible: true,
    severity: "error",
    subpath: ".",
    title: "Package evaluation failed",
    ...overrides,
  };
}

describe("createDiagnostic", () => {
  it("creates a stable ID from the documented identity fields", () => {
    const first = createDiagnostic(diagnostic());
    const second = createDiagnostic(
      diagnostic({
        command: "another command",
        evidence: "different evidence",
        title: "A revised title",
      }),
    );

    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it("changes the ID when an identity field changes", () => {
    const original = createDiagnostic(diagnostic());
    const changed = [
      diagnostic({ code: "PC1002" }),
      diagnostic({ subpath: "./feature" }),
      diagnostic({
        profile: {
          moduleSystem: "cjs",
          runtime: "24.16.0",
          typescriptResolution: "nodenext",
        },
      }),
      diagnostic({
        profile: {
          moduleSystem: "esm",
          runtime: "26.0.0",
          typescriptResolution: "nodenext",
        },
      }),
      diagnostic({
        profile: {
          moduleSystem: "esm",
          runtime: "24.16.0",
          typescriptResolution: "bundler",
        },
      }),
    ];

    for (const input of changed) {
      expect(createDiagnostic(input).id).not.toBe(original.id);
    }
  });

  it("normalizes evidence and redacts host paths", () => {
    const result = createDiagnostic(
      diagnostic({
        command: "node C:\\temp\\consumer\\probe.mjs",
        evidence: "\u001B[31mC:\\temp\\consumer\\index.js\r\nfailed\u0000\u001B[0m",
      }),
      { redactions: { "C:\\temp\\consumer": "<consumer>" } },
    );

    expect(result.command).toBe("node <consumer>/probe.mjs");
    expect(result.evidence).toBe("<consumer>/index.js\nfailed");
  });

  it("sorts and deduplicates explanations", () => {
    const result = createDiagnostic(
      diagnostic({
        explainedBy: ["publint:B", "attw:A", "publint:B"],
      }),
    );

    expect(result.explainedBy).toEqual(["attw:A", "publint:B"]);
  });

  it("copies and freezes an attributed source range", () => {
    const sourceRange = {
      end: { column: 8, line: 2 },
      file: "package.json",
      start: { column: 3, line: 2 },
    };
    const result = createDiagnostic(diagnostic({ sourceRange }));

    expect(result.sourceRange).toEqual(sourceRange);
    expect(Object.isFrozen(result.sourceRange)).toBe(true);
    expect(Object.isFrozen(result.sourceRange?.start)).toBe(true);
  });

  it("rejects invalid codes, subpaths, and titles", () => {
    expect(() => createDiagnostic(diagnostic({ code: "BAD" }))).toThrow(TypeError);
    expect(() => createDiagnostic(diagnostic({ subpath: "feature" }))).toThrow(
      TypeError,
    );
    expect(() => createDiagnostic(diagnostic({ title: " " }))).toThrow(TypeError);
  });

  it("orders diagnostics by stable identity fields", () => {
    const values = [
      createDiagnostic(diagnostic({ code: "PC1002" })),
      createDiagnostic(diagnostic({ code: "PC1001", subpath: "./z" })),
      createDiagnostic(diagnostic({ code: "PC1001", subpath: "./a" })),
    ];

    expect(
      values.sort(compareDiagnostics).map(({ code, subpath }) => [code, subpath]),
    ).toEqual([
      ["PC1001", "./a"],
      ["PC1001", "./z"],
      ["PC1002", "."],
    ]);
    const first = values.at(0);
    expect(first).toBeDefined();
    if (first === undefined) {
      throw new Error("expected a sorted diagnostic");
    }
    expect(compareDiagnostics(first, first)).toBe(0);
  });
});
