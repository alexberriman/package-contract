import { describe, expect, it } from "vitest";
import { createDiagnostic } from "../src/core/diagnostic.js";
import type { ProbeResult } from "../src/core/result.js";
import { applyIncumbentExplanations } from "../src/integrations/suppression.js";
import type { IncumbentFinding } from "../src/integrations/types.js";

const diagnostic = createDiagnostic({
  code: "PC1002",
  command: "typescript nodenext <consumer>/probe.mts",
  evidence: "TS2307: Cannot find module 'example/feature'.",
  explainedBy: null,
  profile: {
    moduleSystem: "esm",
    runtime: "24.16.0",
    typescriptResolution: "nodenext",
  },
  reproducible: false,
  severity: "error",
  subpath: "./feature",
  title: "TypeScript consumer compilation failed",
});

function finding(overrides: Partial<IncumbentFinding> = {}): IncumbentFinding {
  return {
    code: "NoResolution",
    details: {
      entrypoint: "./feature",
      resolutionKind: "node16-esm",
    },
    severity: "error",
    subpath: "./feature",
    tool: "attw",
    version: "0.18.5",
    ...overrides,
  };
}

function failedResult(): ProbeResult {
  return {
    diagnostics: [diagnostic],
    profile: diagnostic.profile,
    state: "fail",
    subpath: diagnostic.subpath,
  };
}

describe("incumbent suppression", () => {
  it("records a matching explanation without changing diagnostic identity", () => {
    const result = applyIncumbentExplanations(failedResult(), [finding()], "example");

    expect(result.state).toBe("fail");
    if (result.state !== "fail") {
      throw new Error("expected a failed result");
    }
    expect(result.diagnostics[0]).toMatchObject({
      explainedBy: ["attw:NoResolution"],
      id: diagnostic.id,
    });
  });

  it("accepts only known Publint declaration explanations", () => {
    const explained = applyIncumbentExplanations(
      failedResult(),
      [
        finding({
          code: "EXPORTS_TYPES_SHOULD_BE_FIRST",
          details: { path: ["exports", "./feature", "types"] },
          tool: "publint",
        }),
      ],
      "example",
    );

    expect(explained.state).toBe("fail");
    if (explained.state !== "fail") {
      throw new Error("expected a failed result");
    }
    expect(explained.diagnostics[0]?.explainedBy).toEqual([
      "publint:EXPORTS_TYPES_SHOULD_BE_FIRST",
    ]);
  });

  it.each([
    ["unknown code", finding({ code: "FutureProblem" })],
    ["other subpath", finding({ subpath: "./other" })],
    [
      "other resolution",
      finding({
        details: {
          entrypoint: "./feature",
          resolutionKind: "node16-cjs",
        },
      }),
    ],
    ["other tool", finding({ tool: "publint" })],
  ])("does not suppress an ambiguous %s", (_label, incumbent) => {
    const result = applyIncumbentExplanations(failedResult(), [incumbent], "example");

    expect(result.state).toBe("fail");
    if (result.state !== "fail") {
      throw new Error("expected a failed result");
    }
    expect(result.diagnostics[0]?.explainedBy).toBeNull();
  });

  it("keeps an unrelated same-subpath failure residual", () => {
    const unrelated = {
      ...diagnostic,
      evidence:
        "TS2307 <consumer>/node_modules/example/index.d.ts: Cannot find module 'unrelated-types'.",
    };
    const result = applyIncumbentExplanations(
      {
        diagnostics: [unrelated],
        profile: unrelated.profile,
        state: "fail",
        subpath: unrelated.subpath,
      },
      [finding()],
      "example",
    );

    expect(result.state).toBe("fail");
    if (result.state !== "fail") {
      throw new Error("expected a failed result");
    }
    expect(result.diagnostics[0]?.explainedBy).toBeNull();
  });
});
