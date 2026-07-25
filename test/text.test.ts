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

  it("preserves normalization invariants across generated Unicode inputs", () => {
    const alphabet = [
      "a",
      " ",
      "\r",
      "\n",
      "\\",
      "\u0000",
      "\u001B[31m",
      "\u001B[0m",
      "é",
      "🙂",
    ];
    let state = 0x6d2b_79f5;
    const random = (): number => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
    };

    for (let sample = 0; sample < 500; sample += 1) {
      const input = Array.from(
        { length: Math.floor(random() * 80) },
        () => alphabet[Math.floor(random() * alphabet.length)] ?? "",
      ).join("");
      const limitBytes = Math.floor(random() * 96);
      const normalized = normalizeText(input, { limitBytes });

      expect(Buffer.byteLength(normalized)).toBeLessThanOrEqual(limitBytes);
      for (const unsafe of ["\r", "\\", "\u0000", "\u001B"]) {
        expect(normalized).not.toContain(unsafe);
      }
      expect(normalizeText(normalized, { limitBytes })).toBe(normalized);
    }
  });
});
