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

  it("does not mistake a finding subpath or target prefix for causality", () => {
    const unrelated = {
      ...diagnostic,
      code: "PC1001",
      evidence:
        "Error: ENOENT: no such file or directory, open '<consumer>/node_modules/example/feature-data.json'",
    };
    const result = applyIncumbentExplanations(
      {
        diagnostics: [unrelated],
        profile: unrelated.profile,
        state: "fail",
        subpath: unrelated.subpath,
      },
      [
        finding({
          code: "FILE_DOES_NOT_EXIST",
          details: {
            path: ["exports", "./feature", "import"],
            target: "./feature",
          },
          tool: "publint",
        }),
      ],
      "example",
    );

    expect(result.state).toBe("fail");
    if (result.state !== "fail") {
      throw new Error("expected a failed result");
    }
    expect(result.diagnostics[0]?.explainedBy).toBeNull();
  });

  it("matches only exact nested Publint targets", () => {
    const runtime = {
      ...diagnostic,
      code: "PC1001",
      evidence:
        "Error: Cannot find module '<consumer>/node_modules/example/missing.js'",
      subpath: ".",
    };
    const result = applyIncumbentExplanations(
      {
        diagnostics: [runtime],
        profile: runtime.profile,
        state: "fail",
        subpath: runtime.subpath,
      },
      [
        finding({
          code: "FILE_DOES_NOT_EXIST",
          details: {
            target: {
              import: [null, "./missing.js"],
            },
          },
          subpath: ".",
          tool: "publint",
        }),
      ],
      "example",
    );

    expect(result.state).toBe("fail");
    if (result.state !== "fail") {
      throw new Error("expected a failed result");
    }
    expect(result.diagnostics[0]?.explainedBy).toEqual(["publint:FILE_DOES_NOT_EXIST"]);
  });

  it("does not match the same filename below a different package directory", () => {
    const runtime = {
      ...diagnostic,
      code: "PC1001",
      evidence:
        "Error: Cannot find module '<consumer>/node_modules/example/foo/missing.js'",
      subpath: ".",
    };
    const result = applyIncumbentExplanations(
      {
        diagnostics: [runtime],
        profile: runtime.profile,
        state: "fail",
        subpath: runtime.subpath,
      },
      [
        finding({
          code: "FILE_DOES_NOT_EXIST",
          details: { target: "./missing.js" },
          subpath: ".",
          tool: "publint",
        }),
      ],
      "example",
    );

    expect(result.state).toBe("fail");
    if (result.state !== "fail") {
      throw new Error("expected a failed result");
    }
    expect(result.diagnostics[0]?.explainedBy).toBeNull();
  });

  it.each([null, [], { path: ["exports", "."] }])(
    "ignores a Publint finding without a concrete target: %j",
    (details) => {
      const runtime = {
        ...diagnostic,
        code: "PC1001",
        evidence: "Error: no such file or directory, open '/missing.js'",
        subpath: ".",
      };
      const result = applyIncumbentExplanations(
        {
          diagnostics: [runtime],
          profile: runtime.profile,
          state: "fail",
          subpath: runtime.subpath,
        },
        [
          finding({
            code: "FILE_DOES_NOT_EXIST",
            details,
            subpath: ".",
            tool: "publint",
          }),
        ],
        "example",
      );

      expect(result.state).toBe("fail");
      if (result.state !== "fail") {
        throw new Error("expected a failed result");
      }
      expect(result.diagnostics[0]?.explainedBy).toBeNull();
    },
  );
});
