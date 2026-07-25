import { describe, expect, it } from "vitest";

import type { PackageManifest } from "../src/core/manifest.js";
import {
  declaredModuleSystems,
  declaresTypes,
  enumerateExportSubpaths,
  expandExportPatterns,
  selectBlockedDeepImport,
} from "../src/profiles/exports.js";

function manifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: "example",
    version: "1.0.0",
    ...overrides,
  };
}

describe("enumerateExportSubpaths", () => {
  it("returns the root for absent and conditional root exports", () => {
    expect(enumerateExportSubpaths(manifest())).toEqual({
      explicit: ["."],
      patterns: [],
    });
    expect(
      enumerateExportSubpaths(
        manifest({ exports: { import: "./index.js", types: "./index.d.ts" } }),
      ),
    ).toEqual({ explicit: ["."], patterns: [] });
    expect(enumerateExportSubpaths(manifest({ exports: "./index.js" }))).toEqual({
      explicit: ["."],
      patterns: [],
    });
  });

  it("sorts explicit subpaths and separates patterns", () => {
    expect(
      enumerateExportSubpaths(
        manifest({
          exports: {
            "./z": "./z.js",
            "./private": null,
            "./features/*": "./features/*.js",
            ".": "./index.js",
          },
        }),
      ),
    ).toEqual({
      explicit: [".", "./z"],
      patterns: ["./features/*"],
    });
  });

  it("rejects mixed subpath and condition keys", () => {
    expect(() =>
      enumerateExportSubpaths(
        manifest({
          exports: { ".": "./index.js", import: "./index.js" },
        }),
      ),
    ).toThrow("mixes condition and subpath keys");
  });
});

describe("expandExportPatterns", () => {
  it("derives conservative concrete subpaths from packed files", () => {
    expect(
      expandExportPatterns(
        manifest({
          exports: {
            "./features/*": {
              import: "./features/*.js",
              types: "./features/*.d.ts",
            },
          },
          type: "module",
        }),
        ["./features/*"],
        ["features/a.js", "features/a.d.ts", "features/nested/b.js"],
      ),
    ).toEqual({
      expanded: ["./features/a"],
      unresolved: [],
    });
  });

  it("keeps patterns that cannot be expanded safely", () => {
    expect(
      expandExportPatterns(
        manifest({ exports: { "./features/*": "./dist/no-match/*.js" } }),
        ["./features/*"],
        ["index.js"],
      ),
    ).toEqual({
      expanded: [],
      unresolved: ["./features/*"],
    });
  });
});

describe("declaredModuleSystems", () => {
  it("recognizes explicit import and require claims", () => {
    const systems = declaredModuleSystems(
      manifest({
        exports: {
          ".": {
            import: "./index.js",
            require: "./index.cjs",
            types: "./index.d.ts",
          },
        },
        type: "module",
      }),
      ".",
    );

    expect([...systems]).toEqual(["esm", "cjs"]);
  });

  it("uses extension and package type for unconditional targets", () => {
    expect([
      ...declaredModuleSystems(
        manifest({ exports: "./index.mjs", type: "commonjs" }),
        ".",
      ),
    ]).toEqual(["esm"]);
    expect([
      ...declaredModuleSystems(
        manifest({ exports: "./index.js", type: "commonjs" }),
        ".",
      ),
    ]).toEqual(["cjs"]);
    expect([
      ...declaredModuleSystems(
        manifest({
          exports: ["./ignored.json", "./index.cjs", "./index.mjs"],
        }),
        ".",
      ),
    ]).toEqual(["cjs", "esm"]);
  });

  it("returns no claim for a blocked or absent subpath", () => {
    expect([
      ...declaredModuleSystems(
        manifest({ exports: { ".": "./index.js", "./private": null } }),
        "./private",
      ),
    ]).toEqual([]);
  });

  it("handles nested custom conditions and ambiguous wildcard matches", () => {
    expect([
      ...declaredModuleSystems(
        manifest({
          exports: {
            ".": {
              custom: {
                import: "./index.js",
                require: "./index.cjs",
              },
            },
          },
          type: "module",
        }),
        ".",
      ),
    ]).toEqual(["esm", "cjs"]);
    expect([
      ...declaredModuleSystems(
        manifest({
          exports: {
            "./feature/*": "./a/*.js",
            "./feature/x*": "./b/*.js",
          },
          type: "module",
        }),
        "./feature/xy",
      ),
    ]).toEqual([]);
  });
});

describe("declaresTypes", () => {
  it("recognizes legacy fields, nested conditions, and arrays", () => {
    expect(declaresTypes(manifest({ types: "./index.d.ts" }), ".")).toBe(true);
    expect(declaresTypes(manifest({ typings: "./index.d.ts" }), ".")).toBe(true);
    expect(declaresTypes(manifest({ types: "./index.d.ts" }), "./feature")).toBe(false);
    expect(
      declaresTypes(
        manifest({
          exports: {
            ".": [{ import: "./index.js" }, { custom: { types: "./index.d.ts" } }],
          },
        }),
        ".",
      ),
    ).toBe(true);
    expect(
      declaresTypes(manifest({ exports: { ".": { import: "./index.js" } } }), "."),
    ).toBe(false);
  });
});

describe("adversarial export patterns", () => {
  it.each([
    [{ "./bad**": "./dist/*.js" }, ["dist/a.js"]],
    [{ "./bad/*": "../dist/*.js" }, ["dist/a.js"]],
    [{ "./bad/*": "dist/*.js" }, ["dist/a.js"]],
    [{ "./bad/*": "./dist/no-star.js" }, ["dist/a.js"]],
    [{ "./bad/*": "./dist/*.js" }, ["dist/nested/a.js"]],
    [{ "./bad/*": "./dist/*.js" }, ["dist/.js"]],
    [{ "./bad/*": "./dist/*.js" }, ["dist/a.d.ts"]],
  ])("leaves unsafe or unmatched patterns unresolved %#", (exports, files) => {
    expect(
      expandExportPatterns(
        manifest({ exports }),
        [Object.keys(exports)[0] as string],
        files,
      ).expanded,
    ).toEqual([]);
  });

  it("walks nested and fallback target structures", () => {
    expect(
      expandExportPatterns(
        manifest({
          exports: {
            "./feature/*": [null, { import: "./dist/*.mjs", require: "./dist/*.cjs" }],
          },
        }),
        ["./feature/*"],
        ["dist/a.mjs", "dist/a.cjs", "dist/readme.md"],
      ),
    ).toEqual({
      expanded: ["./feature/a"],
      unresolved: [],
    });
  });

  it("returns unresolved patterns for non-object exports", () => {
    expect(
      expandExportPatterns(
        manifest({ exports: "./index.js" }),
        ["./feature/*"],
        ["feature/a.js"],
      ),
    ).toEqual({ expanded: [], unresolved: ["./feature/*"] });
  });
});

describe("selectBlockedDeepImport", () => {
  it("selects one deterministic private JavaScript path behind exports", () => {
    expect(
      selectBlockedDeepImport(
        manifest({ exports: { ".": "./index.js" }, type: "module" }),
        ["private/z.js", "index.js", "private/a.js", "readme.md"],
      ),
    ).toBe("./index.js");
  });

  it("returns null without an exports boundary or private JavaScript", () => {
    expect(selectBlockedDeepImport(manifest(), ["private.js"])).toBeNull();
    expect(
      selectBlockedDeepImport(
        manifest({ exports: { ".": "./index.js" }, type: "module" }),
        ["readme.md"],
      ),
    ).toBeNull();
  });
});
