import type { Diagnostic } from "./diagnostic.js";

export type EvaluationState = "fail" | "not-evaluated" | "pass";

export interface NotEvaluatedReason {
  readonly code:
    | "compiler-unavailable"
    | "inapplicable-profile"
    | "offline-cache-miss"
    | "runtime-unavailable"
    | "unsupported-export-pattern";
  readonly message: string;
}

export type ProbeResult =
  | {
      readonly diagnostics: readonly [];
      readonly state: "pass";
    }
  | {
      readonly diagnostics: readonly Diagnostic[];
      readonly state: "fail";
    }
  | {
      readonly diagnostics: readonly [];
      readonly reason: NotEvaluatedReason;
      readonly state: "not-evaluated";
    };
