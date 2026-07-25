import type { JsonValue } from "../core/manifest.js";

export type IncumbentTool = "attw" | "publint";

export interface IncumbentFinding {
  readonly code: string;
  readonly details: JsonValue;
  readonly severity: "error" | "suggestion" | "warning";
  readonly subpath: string | null;
  readonly tool: IncumbentTool;
  readonly version: string;
}

export interface IncumbentAnalysis {
  readonly findings: readonly IncumbentFinding[];
  readonly tools: Readonly<Record<IncumbentTool, string>>;
}
