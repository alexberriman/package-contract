import type { IncumbentFinding, IncumbentTool } from "../integrations/types.js";
import type { BinAction, RuntimeAction } from "../profiles/action.js";
import type { Diagnostic } from "./diagnostic.js";
import type { PackedFile } from "./pack.js";
import type { ProbeResult } from "./result.js";

export type RuntimePlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32";

export interface ReportEnvironment {
  readonly architecture: string;
  readonly npm: string;
  readonly platform: RuntimePlatform;
  readonly profileSchema: 1;
  readonly runnerNode: string;
  readonly typescript: string | null;
}

export interface PackageReport {
  readonly actions: readonly RuntimeAction[];
  readonly bins: readonly BinAction[];
  readonly diagnostics: readonly Diagnostic[];
  readonly environment: ReportEnvironment;
  readonly incumbentFindings: readonly IncumbentFinding[];
  readonly lockfileSha256: string | null;
  readonly package: {
    readonly files: readonly PackedFile[];
    readonly name: string;
    readonly sha256: string;
    readonly version: string;
  };
  readonly results: readonly ProbeResult[];
  readonly tools: Readonly<Record<IncumbentTool, string>>;
}
