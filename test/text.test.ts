import { describe, expect, it } from "vitest";

import { normalizeText } from "../src/core/text.js";

describe("normalizeText", () => {
  it("normalizes separators, line endings, ANSI, and unsafe controls", () => {
    expect(normalizeText("\u001B[31ma\\b\r\nc\u0000\u001B[0m")).toBe("a/b\nc");
  });

  it("applies longest path redactions first", () => {
    expect(
      normalizeText("/tmp/work/consumer/file /tmp/work/file", {
        redactions: {
          "/tmp/work": "<root>",
          "/tmp/work/consumer": "<consumer>",
        },
      }),
    ).toBe("<consumer>/file <root>/file");
  });

  it("truncates by UTF-8 bytes without returning malformed text", () => {
    const result = normalizeText("🙂".repeat(20), { limitBytes: 24 });

    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(24);
    expect(result.endsWith("\n<truncated>")).toBe(true);
    expect(result).not.toContain("�");
  });

  it("rejects invalid byte limits", () => {
    expect(() => normalizeText("x", { limitBytes: -1 })).toThrow(RangeError);
    expect(() => normalizeText("x", { limitBytes: 1.5 })).toThrow(RangeError);
  });

  it("honors limits smaller than the truncation marker", () => {
    for (let limit = 0; limit < 12; limit += 1) {
      expect(
        Buffer.byteLength(normalizeText("x".repeat(100), { limitBytes: limit })),
      ).toBeLessThanOrEqual(limit);
    }
  });
});
