import { checkPackage, createPackageFromTarballData } from "@arethetypeswrong/core";
import { compareCodeUnits } from "../core/order.js";
import { toCanonicalJson } from "./json.js";
import type { IncumbentFinding } from "./types.js";

export const ATTW_VERSION = "0.18.5";

function problemSubpath(problem: object): string | null {
  if ("entrypoint" in problem && typeof problem.entrypoint === "string") {
    return problem.entrypoint;
  }
  return null;
}

export async function analyzeWithAttw(
  tarball: Uint8Array,
): Promise<readonly IncumbentFinding[]> {
  const result = await checkPackage(createPackageFromTarballData(tarball));
  if (!("problems" in result)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    result.problems
      .map((problem) =>
        Object.freeze({
          code: problem.kind,
          details: toCanonicalJson(problem),
          severity: "error" as const,
          subpath: problemSubpath(problem),
          tool: "attw" as const,
          version: ATTW_VERSION,
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
