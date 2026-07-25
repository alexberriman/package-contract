import type { ConsumerProfileId, Diagnostic } from "./diagnostic.js";

export type EvaluationState = "fail" | "not-evaluated" | "pass";

export interface NotEvaluatedReason {
  readonly code:
    | "compiler-unavailable"
    | "inapplicable-profile"
    | "offline-cache-miss"
    | "resource-limit"
    | "runtime-unavailable"
    | "unsupported-export-pattern"
    | "unexpected-probe-failure";
  readonly message: string;
}

export type ProbeResult =
  | {
      readonly diagnostics: readonly [];
      readonly profile: ConsumerProfileId;
      readonly state: "pass";
      readonly subpath: string;
    }
  | {
      readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
      readonly profile: ConsumerProfileId;
      readonly state: "fail";
      readonly subpath: string;
    }
  | {
      readonly diagnostics: readonly [];
      readonly profile: ConsumerProfileId;
      readonly reason: NotEvaluatedReason;
      readonly state: "not-evaluated";
      readonly subpath: string;
    };
