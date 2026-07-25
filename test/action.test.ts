import { describe, expect, it } from "vitest";
import { defineBinActions, defineRuntimeActions } from "../src/index.js";

describe("defineRuntimeActions", () => {
  it("normalizes actions deterministically and freezes arguments", () => {
    const actions = defineRuntimeActions([
      {
        arguments: [{ nested: [true, null] }],
        exportName: "load",
        kind: "call",
        subpath: ".",
      },
      { exportName: "asset", kind: "read-file", subpath: "." },
    ]);

    expect(actions.map(({ kind }) => kind)).toEqual(["call", "read-file"]);
    expect(Object.isFrozen(actions)).toBe(true);
    expect(Object.isFrozen(actions[0]?.arguments)).toBe(true);
  });

  it("rejects unsafe paths, names, and non-JSON arguments", () => {
    expect(() =>
      defineRuntimeActions([
        { exportName: "value", kind: "export", subpath: "../private" },
      ]),
    ).toThrow("subpath is invalid");
    expect(() =>
      defineRuntimeActions([{ exportName: "bad\nname", kind: "export", subpath: "." }]),
    ).toThrow("export name is invalid");
    expect(() =>
      defineRuntimeActions([
        {
          arguments: [Number.NaN],
          exportName: "load",
          kind: "call",
          subpath: ".",
        },
      ]),
    ).toThrow("arguments must contain JSON values");
  });
});

describe("defineBinActions", () => {
  it("sorts and freezes executable actions", () => {
    const actions = defineBinActions([
      { name: "z" },
      { arguments: ["--help"], name: "a" },
    ]);

    expect(actions).toEqual([
      { arguments: ["--help"], name: "a" },
      { arguments: [], name: "z" },
    ]);
    expect(Object.isFrozen(actions[0]?.arguments)).toBe(true);
  });

  it("rejects unsafe executable names and arguments", () => {
    expect(() => defineBinActions([{ name: "../bin" }])).toThrow("name is invalid");
    expect(() =>
      defineBinActions([{ arguments: ["bad\nargument"], name: "example" }]),
    ).toThrow("arguments are invalid");
  });
});
