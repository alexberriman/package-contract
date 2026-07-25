import { unpack } from "@publint/pack";
import { publint } from "publint";
import { compareCodeUnits } from "../core/order.js";
import { toCanonicalJson } from "./json.js";
import type { IncumbentFinding } from "./types.js";

export const PUBLINT_VERSION = "0.3.22";

function findSubpath(path: readonly string[]): string | null {
  return path.find((part) => part === "." || part.startsWith("./")) ?? null;
}

export async function analyzeWithPublint(
  tarball: Uint8Array,
): Promise<readonly IncumbentFinding[]> {
  const unpacked = await unpack(tarball);
  const result = await publint({
    level: "suggestion",
    pack: {
      files: unpacked.files.map(({ data, name }) => ({ data, name })),
    },
    pkgDir: unpacked.rootDir,
  });
  return Object.freeze(
    result.messages
      .map((message) =>
        Object.freeze({
          code: message.code,
          details: toCanonicalJson({
            args: message.args,
            path: message.path,
          }),
          severity: message.type,
          subpath: findSubpath(message.path),
          tool: "publint" as const,
          version: PUBLINT_VERSION,
        }),
      )
      .sort(
        (left, right) =>
          compareCodeUnits(left.code, right.code) ||
          compareCodeUnits(left.subpath ?? "", right.subpath ?? "") ||
          compareCodeUnits(JSON.stringify(left.details), JSON.stringify(right.details)),
      ),
  );
}
