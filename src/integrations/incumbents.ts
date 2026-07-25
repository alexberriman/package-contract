import { readFile } from "node:fs/promises";
import { ATTW_VERSION, analyzeWithAttw } from "./attw.js";
import { analyzeWithPublint, PUBLINT_VERSION } from "./publint.js";
import type { IncumbentAnalysis } from "./types.js";

export async function analyzeWithIncumbents(
  tarballPath: string,
): Promise<IncumbentAnalysis> {
  const bytes = await readFile(tarballPath);
  const [attw, publint] = await Promise.all([
    analyzeWithAttw(bytes),
    analyzeWithPublint(bytes),
  ]);
  return Object.freeze({
    findings: Object.freeze([...attw, ...publint]),
    tools: Object.freeze({
      attw: ATTW_VERSION,
      publint: PUBLINT_VERSION,
    }),
  });
}
