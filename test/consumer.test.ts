import { describe, expect, it } from "vitest";

import { defineConsumer } from "../src/index.js";

describe("defineConsumer", () => {
  it("normalizes versions and subpaths deterministically", () => {
    const profile = defineConsumer({
      moduleSystem: "esm",
      runtime: { executable: "/opt/node", version: "v24.16.0" },
      subpaths: ["./z", ".", "./a", "./z"],
      typescriptResolution: "nodenext",
    });

    expect(profile).toEqual({
      id: {
        moduleSystem: "esm",
        runtime: "24.16.0",
        typescriptResolution: "nodenext",
      },
      runtime: {
        executable: "/opt/node",
        version: "24.16.0",
      },
      subpaths: [".", "./a", "./z"],
    });
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("defaults the executable and root subpath", () => {
    const profile = defineConsumer({
      moduleSystem: "esm",
      runtime: { version: "24" },
    });

    expect(profile.runtime.executable).toBe(process.execPath);
    expect(profile.subpaths).toEqual(["."]);
    expect(profile.id.typescriptResolution).toBeNull();
  });

  it("rejects malformed versions and subpaths", () => {
    expect(() =>
      defineConsumer({
        moduleSystem: "esm",
        runtime: { version: "latest" },
      }),
    ).toThrow(TypeError);
    expect(() =>
      defineConsumer({
        moduleSystem: "esm",
        runtime: { version: "24" },
        subpaths: ["feature"],
      }),
    ).toThrow(TypeError);
    expect(() =>
      defineConsumer({
        moduleSystem: "esm",
        runtime: { version: "24" },
        subpaths: ["./feature\nforged"],
      }),
    ).toThrow(TypeError);
  });

  it("rejects bundler resolution for CommonJS", () => {
    expect(() =>
      defineConsumer({
        moduleSystem: "cjs",
        runtime: { version: "24" },
        typescriptResolution: "bundler",
      }),
    ).toThrow(TypeError);
  });
});
