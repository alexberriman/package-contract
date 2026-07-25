import { describe, expect, it } from "vitest";

import type { PackageManifest } from "../src/core/manifest.js";
import {
  declaredModuleSystems,
  enumerateExportSubpaths,
  expandExportPatterns,
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
  });

  it("returns no claim for a blocked or absent subpath", () => {
    expect([
      ...declaredModuleSystems(
        manifest({ exports: { ".": "./index.js", "./private": null } }),
        "./private",
      ),
    ]).toEqual([]);
  });
});
