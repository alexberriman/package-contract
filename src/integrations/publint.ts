import { unpack } from "@publint/pack";
import { publint } from "publint";
import type { JsonValue } from "../core/manifest.js";
import { compareCodeUnits } from "../core/order.js";
import { toCanonicalJson } from "./json.js";
import type { IncumbentFinding } from "./types.js";

export const PUBLINT_VERSION = "0.3.22";

function findSubpath(path: readonly string[]): string | null {
  return path.find((part) => part === "." || part.startsWith("./")) ?? null;
}

function manifestValueAtPath(
  manifest: JsonValue,
  path: readonly string[],
): JsonValue | undefined {
  let value: JsonValue | undefined = manifest;
  for (const part of path) {
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      !(part in value)
    ) {
      return undefined;
    }
    value = (value as { readonly [key: string]: JsonValue })[part];
  }
  return value;
}

export async function analyzeWithPublint(
  tarball: Uint8Array,
): Promise<readonly IncumbentFinding[]> {
  const unpacked = await unpack(tarball);
  const manifestFile = unpacked.files.find(
    ({ name }) => name === `${unpacked.rootDir}/package.json`,
  );
  const manifest =
    manifestFile === undefined
      ? null
      : (JSON.parse(new TextDecoder().decode(manifestFile.data)) as JsonValue);
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
            target: manifestValueAtPath(manifest, message.path),
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
