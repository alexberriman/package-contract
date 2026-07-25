import { describe, expect, it } from "vitest";

import { toCanonicalJson } from "../src/integrations/json.js";

describe("incumbent JSON normalization", () => {
  it("sorts nested values, removes undefined fields, and stringifies unknowns", () => {
    expect(
      toCanonicalJson({
        z: undefined,
        nested: { beta: 2, alpha: 1 },
        array: [true, 3n],
      }),
    ).toEqual({
      array: [true, "3"],
      nested: { alpha: 1, beta: 2 },
    });
    expect(toCanonicalJson(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});
