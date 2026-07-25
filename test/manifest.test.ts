import { describe, expect, it } from "vitest";

import { declaredBinNames, parsePackageManifest } from "../src/core/manifest.js";

describe("parsePackageManifest", () => {
  it("retains the package fields used for profile applicability", () => {
    expect(
      parsePackageManifest({
        bin: { example: "./cli.js" },
        engines: { node: ">=24" },
        exports: "./index.js",
        name: "@scope/example",
        type: "module",
        types: "./index.d.ts",
        version: "1.2.3-beta.1",
      }),
    ).toEqual({
      bin: { example: "./cli.js" },
      engines: { node: ">=24" },
      exports: "./index.js",
      name: "@scope/example",
      type: "module",
      types: "./index.d.ts",
      version: "1.2.3-beta.1",
    });
  });

  it.each([
    null,
    [],
    {},
    { name: "Bad Name", version: "1.0.0" },
    { name: "example", version: "" },
    { name: "example", type: "invalid", version: "1.0.0" },
    { name: "example", types: 42, version: "1.0.0" },
    { exports: { "\u0000": "./index.js" }, name: "example", version: "1.0.0" },
    { engines: Number.NaN, name: "example", version: "1.0.0" },
  ])("rejects malformed manifest data %#", (value) => {
    expect(() => parsePackageManifest(value)).toThrow();
  });
});

describe("declaredBinNames", () => {
  it("normalizes string and object bin declarations", () => {
    expect([
      ...declaredBinNames(
        parsePackageManifest({
          bin: "./cli.js",
          name: "@scope/example",
          version: "1.0.0",
        }),
      ),
    ]).toEqual(["example"]);
    expect([
      ...declaredBinNames(
        parsePackageManifest({
          bin: { a: "./a.js", ignored: null, z: "./z.js" },
          name: "example",
          version: "1.0.0",
        }),
      ),
    ]).toEqual(["a", "z"]);
    expect([
      ...declaredBinNames(parsePackageManifest({ name: "example", version: "1.0.0" })),
    ]).toEqual([]);
  });
});
