import { describe, expect, it } from "vitest";

import { mapConcurrent } from "../src/core/concurrency.js";

describe("mapConcurrent", () => {
  it("bounds active work and preserves input order", async () => {
    let active = 0;
    let maximum = 0;
    const results = await mapConcurrent([3, 1, 2, 0], 2, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, value * 2));
      active -= 1;
      return value * 10;
    });

    expect(results).toEqual([30, 10, 20, 0]);
    expect(maximum).toBe(2);
  });

  it("handles an empty input and validates its limit", async () => {
    await expect(mapConcurrent([], 2, async (value) => value)).resolves.toEqual([]);
    await expect(mapConcurrent([1], 0, async (value) => value)).rejects.toThrow(
      RangeError,
    );
  });
});
